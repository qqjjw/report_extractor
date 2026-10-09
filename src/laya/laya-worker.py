"""Local Laya 0.4 worker; stdout contains only our JSON Lines protocol."""
import contextlib
import json
import sys

QUESTIONS = {
    "same": {"type": "noul", "instructions": "두 표는 다른 연도의 같은 종류의 공시 표인가? 금액과 연도 차이는 무시하고 항목, 열, 목차와 표의 목적을 비교하라."},
    "scope_conflict": {"type": "noul", "instructions": "두 표의 비교 범위가 명확히 다른가? 연결과 별도 재무정보, 그룹과 개별 회사, 전체와 특정 사업부의 차이를 확인하라. 정보가 없다는 것만으로 충돌로 판단하지 마라."},
    "period": {"type": "choice", "instructions": "후보 표가 나타내는 보고기간 유형은?", "criteria": {
        "current": "당기 또는 해당 보고서의 현재 연도 표", "previous": "전기 또는 이전 연도만의 표",
        "mixed": "하나의 표 안에 당기와 전기를 함께 표시", "unknown": "판단 정보 부족"}}
}


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def summary(table):
    result = {k: table.get(k) for k in ("title", "context", "tocPath", "headers", "rowLabels", "rowCount", "columnCount")}
    # Cell amounts are deliberately absent from the comparison state.
    return result


def fit_state(pair, agent):
    state = {"source": summary(pair["source"]), "candidate": summary(pair["candidate"])}
    shortened = False
    # Reserve question-head room; never allow the SDK to silently cut the input tail.
    while len(agent.tok.encode(json.dumps(state, ensure_ascii=False), add_special_tokens=False)) > 6000:
        changed = False
        for section in state.values():
            labels = section.get("rowLabels") or []
            if len(labels) > 12:
                section["rowLabels"] = labels[:max(12, len(labels)//2)]; changed = True
            elif len(section.get("context") or "") > 200:
                section["context"] = section["context"][:200]; changed = True
            else:
                for key in ("headers", "rowLabels"):
                    values = section.get(key) or []
                    limited = [str(v)[:120] for v in values[:12]]
                    if limited != values: section[key] = limited; changed = True
                for key in ("title",):
                    if len(section.get(key) or "") > 200: section[key] = section[key][:200]; changed = True
                if sum(len(str(v)) for v in section.get("tocPath") or []) > 400:
                    section["tocPath"] = [str(v)[:100] for v in (section["tocPath"] or [])[-4:]]; changed = True
        shortened = True
        if not changed: raise ValueError("판정 입력이 모델 한도를 초과합니다.")
    return state, shortened


def main():
    router = agent = None
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                if request["type"] == "init":
                    import laya
                    config = request["config"]
                    kwargs = {"device": config.get("device") or None}
                    if config.get("modelPath"): kwargs["models"] = {"multilingual": config["modelPath"]}
                    router = laya.Router(**kwargs)
                    agent = router.load("multilingual")
                    output = {"version": laya.__version__, "model": "multilingual"}
                elif request["type"] == "judge":
                    if router is None: raise RuntimeError("Laya가 준비되지 않았습니다.")
                    prepared = [fit_state(pair, agent) for pair in request["pairs"]]
                    results = router.predict_batch([{"state": state, "questions": QUESTIONS, "model": "multilingual", "lang": "ko", "max_len": 8192, "head_max_len": 512} for state, _ in prepared], batch_size=4)
                    output = []
                    for result, (_, shortened) in zip(results, prepared):
                        answers = result["answers"]
                        output.append({"sameProbability": answers["same"]["noul"],
                            "scopeConflictProbability": answers["scope_conflict"]["noul"],
                            "period": answers["period"]["choice"], "periodProbabilities": answers["period"].get("probabilities"),
                            "confidence": answers["same"].get("confidence"),
                            "truncated": bool(shortened or result.get("usage", {}).get("truncated")), "model": "multilingual"})
                else: raise ValueError("지원하지 않는 요청입니다.")
            emit({"id": request["id"], "ok": True, "result": output})
        except Exception as error:
            emit({"id": request.get("id") if request else None, "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
