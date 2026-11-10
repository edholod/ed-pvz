import unittest
from sync_embedded import merge, ALLOW, DEST
class EmbeddedSync(unittest.TestCase):
    def test_portal_adaptation_and_upstream_fix_survive(self):
        self.assertEqual(merge(b'portal\nb\nc\n',b'a\nb\nc\n',b'a\nb\nfixed\n'),b'portal\nb\nfixed\n')
    def test_overlap_stops_publication(self):
        with self.assertRaises(ValueError):merge(b'local\n',b'base\n',b'upstream\n')
    def test_only_explicit_non_game_sources_and_destinations(self):
        self.assertEqual(DEST,{'qr','finance','rating','academy','ege','control'})
        self.assertEqual(len(ALLOW),4)
if __name__=='__main__':unittest.main()
