from __future__ import annotations

import unittest

from eval.segmentation import semantic_segments, text_units


class SegmentationTests(unittest.TestCase):
    def test_headings_are_not_standalone_segments(self):
        text = "Animales representados:\n- León.\n\nFondo:\n- Rojo intenso."
        segments = semantic_segments(text)
        self.assertTrue(any("León" in segment for segment in segments))
        self.assertFalse(any(segment.endswith(":") for segment in segments))

    def test_full_plus_segments_keeps_one_full_and_no_duplicates(self):
        text = "Escena principal:\n- Una mujer con flores.\n\nColores:\n- Rojo y dorado."
        units = text_units(text, "full_plus_segments")
        self.assertEqual(sum(kind == "full" for kind, _ in units), 1)
        self.assertEqual(len({value.casefold() for _, value in units}), len(units))

    def test_single_short_text_is_not_duplicated(self):
        units = text_units("Una etiqueta roja.", "full_plus_segments")
        self.assertEqual(units, [("full", "Una etiqueta roja.")])

    def test_single_semantic_block_is_not_duplicated(self):
        text = "Animales representados:\n- Un león rampante."
        units = text_units(text, "full_plus_segments")
        self.assertEqual(len(units), 1)
        self.assertEqual(units[0][0], "full")


if __name__ == "__main__":
    unittest.main()
