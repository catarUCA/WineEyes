from __future__ import annotations

import unittest

from eval.audit_inputs import validate_collection_payloads
from eval.data_io import CorpusItem, EXPECTED_EVAL_IDS, canonical_eval_id
from eval.qdrant_eval import deterministic_point_id, documents_for_item


class IdentifierTests(unittest.TestCase):
    def test_eval_id_is_stable_across_rebuilds(self):
        item = CorpusItem("2_08", "eval/muestra/2/08.JPG", 2, "08.JPG", "Primera frase. Segunda frase.")
        first = documents_for_item(item, "full_plus_segments")
        second = documents_for_item(item, "full_plus_segments")
        self.assertEqual(first, second)
        self.assertTrue(all(document.eval_id == "2_08" for document in first))
        self.assertEqual(
            [deterministic_point_id("collection", document.segment_id) for document in first],
            [deterministic_point_id("collection", document.segment_id) for document in second],
        )

    def test_no_positional_id_translation(self):
        self.assertEqual(canonical_eval_id("3_03"), "3_03")
        for invalid in ("303", "101", "51", "0", "3_3"):
            with self.assertRaises(ValueError):
                canonical_eval_id(invalid)

    def test_collection_payload_validation_rejects_external_document(self):
        payloads = [
            {
                "eval_id": eval_id,
                "image_path": f"eval/muestra/{eval_id}.jpg",
                "group": int(eval_id[0]),
                "filename": f"{eval_id}.jpg",
                "segment_id": f"{eval_id}:full",
                "segment_type": "full",
                "segment_text": "text",
            }
            for eval_id in EXPECTED_EVAL_IDS
        ]
        self.assertEqual(validate_collection_payloads(payloads)["unknown_ids"], [])
        payloads.append({**payloads[0], "eval_id": "production-99"})
        self.assertEqual(validate_collection_payloads(payloads)["unknown_ids"], ["production-99"])


if __name__ == "__main__":
    unittest.main()

