
import unittest
from common import scene_id_to_image_id, hamming_distance, construct_image_urls

class TestCommon(unittest.TestCase):
    def test_scene_id_to_image_id(self):
        # Test deterministic hashing
        scene_id = "test_scene_123"
        image_id = scene_id_to_image_id(scene_id)
        self.assertIsInstance(image_id, int)
        self.assertTrue(0 <= image_id < 10**9)
        
        # Test consistency
        self.assertEqual(scene_id_to_image_id(scene_id), image_id)
        
        # Test different input
        self.assertNotEqual(scene_id_to_image_id("other_scene"), image_id)

    def test_hamming_distance(self):
        # Test exact match
        h1 = "ffff"
        self.assertEqual(hamming_distance(h1, h1), 0)
        
        # Test complete mismatch
        h2 = "0000"
        self.assertEqual(hamming_distance(h1, h2), 4)
        
        # Test partial match
        h3 = "ff00"
        self.assertEqual(hamming_distance(h1, h3), 2)
        
        # Test invalid inputs
        self.assertEqual(hamming_distance("abc", "abcd"), float('inf'))
        self.assertEqual(hamming_distance(None, "abc"), float('inf'))

    def test_construct_image_urls(self):
        # Mock storage backend
        class MockStorage:
            def get_file_url(self, key):
                return f"https://cdn.example.com/{key}"
        
        storage = MockStorage()
        
        # Test with R2 key (CDN)
        urls = construct_image_urls(storage, "scene123", 12345, "scene123")
        self.assertEqual(urls['image_url'], "https://cdn.example.com/scene123/original.jpg")
        self.assertEqual(urls['thumbnail_url'], "https://cdn.example.com/scene123/thumb.avif")
        
        # Test without R2 key (Local fallback)
        urls = construct_image_urls(storage, None, 12345, "scene123")
        self.assertEqual(urls['image_url'], "/api/public/scenes/scene123/image")
        self.assertEqual(urls['thumbnail_url'], "/api/public/scenes/scene123/thumbnail")
        
        # Test without R2 key and without scene_id (Legacy fallback)
        urls = construct_image_urls(storage, None, 12345, None)
        self.assertEqual(urls['image_url'], "/api/public/images/12345/image")
        self.assertEqual(urls['thumbnail_url'], "/api/public/images/12345/thumbnail")

if __name__ == '__main__':
    unittest.main()
