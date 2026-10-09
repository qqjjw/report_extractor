"""Protocol and input-budget tests without loading model weights."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace, ModuleType
from unittest import TestCase, main, mock

spec = importlib.util.spec_from_file_location("worker", Path(__file__).parents[1] / "src/laya/laya-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class ChoiceTests(TestCase):
    def setUp(self):
        self.selection = {"stage": "표", "source": {"target": "현금흐름표"},
                          "candidates": [{"id": "upper", "description": {"title": "당기"}},
                                         {"id": "lower", "description": {"title": "전기"}}]}
        self.agent = SimpleNamespace(tok=SimpleNamespace(mask_token='[MASK]'), cfg={"max_len": 8192})

    def sdk(self, truncated=False):
        module = ModuleType("laya.common")
        def build_sequence(tok, state, question, **kwargs):
            self.assertEqual(question["t"], "choice")
            self.assertEqual(list(question["crit"]), ["c0", "c1"])
            self.assertTrue(all(question["crit"].values()))
            if "candidates" in state:
                self.assertEqual(len(state["candidates"]), 2)
            return [], [0, 1], {"options_distinct": 2, "tokens_per_option": None}, {"truncated": truncated}
        module.build_sequence = build_sequence
        module.encode_text = lambda tok, text, **kwargs: {"input_ids": text.split()}
        module.render_options = lambda question: [f"{key}: {value}" for key, value in question["crit"].items()]
        return mock.patch.dict("sys.modules", {"laya.common": module})

    def test_one_choice_question_and_no_confidence_gate(self):
        calls = []
        def predict(**kwargs):
            calls.append(kwargs)
            self.assertEqual(list(kwargs["questions"]), ["select"])
            self.assertEqual(kwargs["questions"]["select"]["type"], "choice")
            self.assertEqual(len(kwargs["questions"]["select"]["criteria"]), 2)
            self.assertEqual('Candidate c0', kwargs["questions"]["select"]["criteria"]["c0"])
            self.assertTrue(kwargs["questions"]["select"]["instructions"].isascii())
            return {"answers": {"select": {"choice": "c0", "probabilities": {"c0": .01, "c1": .99}}}}
        with self.sdk():
            result = worker.choose(self.selection, SimpleNamespace(predict=predict), self.agent)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["selectedId"], "upper")
        self.assertEqual(result["probabilities"]["upper"], .01)

    def test_over_budget_does_not_infer_or_drop_candidates(self):
        predict = mock.Mock()
        with self.sdk(truncated=True):
            with self.assertRaisesRegex(ValueError, "전체 한도.*질문 예약.*토큰"):
                worker.choose(self.selection, SimpleNamespace(predict=predict), self.agent)
        predict.assert_not_called()

    def test_sdk_truncation_rejects_without_second_inference(self):
        predict = mock.Mock(return_value={"usage": {"truncated": True}})
        with self.sdk():
            with self.assertRaisesRegex(ValueError, "SDK"):
                worker.choose(self.selection, SimpleNamespace(predict=predict), self.agent)
        self.assertEqual(predict.call_count, 1)

    def test_top_level_headings_are_real_choices_with_only_current_reference(self):
        self.selection["stage"] = "목차"
        self.selection["source"] = {"target": "III. 재무에 관한 사항", "tocPath": ["III. 재무에 관한 사항", "연결재무제표 주석", "현금흐름표"]}
        self.selection["candidates"] = [{"id": "company", "description": {"title": "I. 회사의 개요"}},
                                        {"id": "finance", "description": {"title": "III. 재무에 관한 사항"}}]
        with self.sdk():
            state, questions, labels, *_ = worker.prepare_choice(self.selection, self.agent)
        self.assertEqual(state, {"reference_heading": "III. 재무에 관한 사항"})
        self.assertEqual(questions["select"]["criteria"]["c1"], "III. 재무에 관한 사항")
        self.assertEqual(labels["c1"], "finance")
        self.assertNotIn("table", questions["select"]["instructions"])

    def test_body_question_and_duplicate_titles_preserve_parent_paths(self):
        self.selection["stage"] = "본문 제목"
        self.selection["source"]["parentPath"] = ["연결재무제표 주석"]
        for candidate, parent in zip(self.selection["candidates"], ["연결", "별도"]):
            candidate["description"] = {"title": "현금흐름표", "path": [parent, "현금흐름표"]}
        with self.sdk():
            state, questions, *_ = worker.prepare_choice(self.selection, self.agent)
        self.assertEqual(state["selected_parent_path"], ["연결재무제표 주석"])
        self.assertEqual(state["candidate_parent_paths"]["c1"], ["별도"])
        self.assertIn("body subsection", questions["select"]["instructions"])

    def test_long_option_fails_before_inference_instead_of_sdk_48_token_cut(self):
        self.selection["stage"] = "목차"
        self.selection["candidates"][0]["description"]["title"] = "word " * 60
        predict = mock.Mock()
        with self.sdk():
            with self.assertRaisesRegex(ValueError, "48토큰"):
                worker.choose(self.selection, SimpleNamespace(predict=predict), self.agent)
        predict.assert_not_called()

    def test_table_text_is_preserved_without_metadata_or_silent_cut(self):
        text = "당기\n항목 | 금액\n퇴직급여\n" * 100
        self.selection["source"]["table"] = {"text": text, "title": "제목" * 100}
        self.selection["candidates"][0]["description"].update(text=text, bodyOrder=4)
        question, labels = worker.build_question(self.selection)
        state = worker.build_state(self.selection, labels, 60)
        self.assertEqual(state["reference_table"], text)
        self.assertEqual(len(state["candidates"]), 2)
        self.assertEqual(state["candidates"][0]["text"], text)
        self.assertEqual(state["candidates"][0]["order"], 4)
        self.assertNotIn("title", state["candidates"][0])

    def test_heading_variants_stay_in_korean_and_table_instructions_are_separate(self):
        self.selection["stage"] = "목차"
        self.selection["candidates"][0]["description"]["title"] = "III. 재무 에 관한 사항"
        question, _ = worker.build_question(self.selection)
        self.assertEqual(question["criteria"]["c0"], "III. 재무 에 관한 사항")
        self.assertIn("exact title match", question["instructions"])
        self.selection["stage"] = "표"
        question, _ = worker.build_question(self.selection)
        self.assertIn("row and column text", question["instructions"])
        self.assertNotIn("exact title match", question["instructions"])

    def test_table_option_drops_only_auxiliary_hint_when_full_title_fits(self):
        title = "word " * 45
        self.selection["candidates"][0]["description"].update(title=title, bodyOrder=4, context="당기")
        with self.sdk():
            state, questions, *_ = worker.prepare_choice(self.selection, self.agent)
        self.assertEqual(questions["select"]["criteria"]["c0"], "Candidate c0")
        self.assertEqual(state["candidates"][0]["order"], 4)


if __name__ == "__main__":
    main()
