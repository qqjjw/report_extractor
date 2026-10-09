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
        self.selection = {"stage": "表", "source": {"target": "현금흐름표"},
                          "candidates": [{"id": "upper", "description": {"title": "당기"}},
                                         {"id": "lower", "description": {"title": "전기"}}]}
        self.agent = SimpleNamespace(tok=None, cfg={"max_len": 8192})

    def sdk(self, truncated=False):
        module = ModuleType("laya.common")
        def build_sequence(tok, state, question, **kwargs):
            self.assertEqual(question["t"], "choice")
            self.assertEqual(list(question["crit"]), ["c0", "c1"])
            self.assertEqual(len(state["candidates"]), 2)
            return [], [0, 1], {"options_distinct": 2, "tokens_per_option": None}, {"truncated": truncated}
        module.build_sequence = build_sequence
        return mock.patch.dict("sys.modules", {"laya.common": module})

    def test_one_choice_question_and_no_confidence_gate(self):
        calls = []
        def predict(**kwargs):
            calls.append(kwargs)
            self.assertEqual(list(kwargs["questions"]), ["select"])
            self.assertEqual(kwargs["questions"]["select"]["type"], "choice")
            self.assertEqual(len(kwargs["questions"]["select"]["criteria"]), 2)
            return {"answers": {"select": {"choice": "c0", "probabilities": {"c0": .01, "c1": .99}}}}
        with self.sdk():
            result = worker.choose(self.selection, SimpleNamespace(predict=predict), self.agent)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["selectedId"], "upper")
        self.assertEqual(result["probabilities"]["upper"], .01)

    def test_over_budget_does_not_infer_or_drop_candidates(self):
        predict = mock.Mock()
        with self.sdk(truncated=True):
            with self.assertRaisesRegex(ValueError, "모든 후보"):
                worker.choose(self.selection, SimpleNamespace(predict=predict), self.agent)
        predict.assert_not_called()

    def test_sdk_truncation_rejects_without_second_inference(self):
        predict = mock.Mock(return_value={"usage": {"truncated": True}})
        with self.sdk():
            with self.assertRaisesRegex(ValueError, "SDK"):
                worker.choose(self.selection, SimpleNamespace(predict=predict), self.agent)
        self.assertEqual(predict.call_count, 1)


if __name__ == "__main__":
    main()
