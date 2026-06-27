from eval.utils import get_rs, iter_all_images
from eval.index_variant import index_descriptions, VariantSystem
from eval.run_retrieval import load_queries, run_and_save, evaluate


def main():
    rs = get_rs()
    items = list(iter_all_images(rs))
    variantes = {
        "seg_full": "eval_seg_full",
        "seg_segments": "eval_seg_segments",
        "seg_both": "eval_seg_both",
    }
    modes = {"eval_seg_full": "full", "eval_seg_segments": "segments", "eval_seg_both": "both"}
    for col, mode in modes.items():
        index_descriptions(rs, col, items, mode=mode)

    systems = [VariantSystem(rs, col, name) for name, col in variantes.items()]
    queries = load_queries("data/queries.csv")
    rankings = run_and_save(systems, queries)
    evaluate(rankings, queries)


if __name__ == "__main__":
    main()
