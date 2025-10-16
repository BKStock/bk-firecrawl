import unittest
from unittest.mock import patch, MagicMock
import os
from firecrawl.v2 import FirecrawlClient


class TestTimeoutConversion(unittest.TestCase):
    
    @patch('requests.post')
    def test_scrape_url_timeout_conversion(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.return_value = {
            'success': True,
            'data': {
                'markdown': 'Test content'
            }
        }
        mock_post.return_value = mock_response

        client = FirecrawlClient(api_key=os.environ.get('TEST_API_KEY', 'dummy-api-key-for-testing'))
        client.scrape('https://example.com', timeout=60000)

        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs['timeout'], 65.0)

    @patch('requests.post')
    def test_scrape_url_default_timeout(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.return_value = {
            'success': True,
            'data': {
                'markdown': 'Test content'
            }
        }
        mock_post.return_value = mock_response

        client = FirecrawlClient(api_key=os.environ.get('TEST_API_KEY', 'dummy-api-key-for-testing'))
        client.scrape('https://example.com', timeout=30000)

        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs['timeout'], 35.0)

    @patch('requests.post')
    def test_post_request_timeout_conversion(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.return_value = {'success': True, 'data': {}}
        mock_post.return_value = mock_response

        client = FirecrawlClient(api_key=os.environ.get('TEST_API_KEY', 'dummy-api-key-for-testing'))
        
        # Test the HttpClient.post method directly with timeout in data
        client.http_client.post('/v2/scrape', {'url': 'https://example.com', 'timeout': 30000})

        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs['timeout'], 35.0)

    @patch('requests.post')
    def test_post_request_default_timeout(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.return_value = {'success': True, 'data': {}}
        mock_post.return_value = mock_response

        client = FirecrawlClient(api_key=os.environ.get('TEST_API_KEY', 'dummy-api-key-for-testing'))
        
        # Test the HttpClient.post method directly with timeout in data
        client.http_client.post('/v2/scrape', {'url': 'https://example.com', 'timeout': 30000})

        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs['timeout'], 35.0)

    @patch('requests.post')
    def test_timeout_edge_cases(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.return_value = {
            'success': True,
            'data': {
                'markdown': 'Test content'
            }
        }
        mock_post.return_value = mock_response

        client = FirecrawlClient(api_key=os.environ.get('TEST_API_KEY', 'dummy-api-key-for-testing'))
        
        # Test small timeout: 1000ms -> 1.0s + 5s buffer = 6.0s
        client.scrape('https://example.com', timeout=1000)
        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs['timeout'], 6.0)
        
        # Test minimum valid timeout: 1ms -> 0.001s + 5s buffer = 5.001s
        client.scrape('https://example.com', timeout=1)
        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs['timeout'], 5.001)

    @patch('requests.post')
    def test_post_request_no_timeout_key(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.return_value = {'success': True, 'data': {}}
        mock_post.return_value = mock_response

        client = FirecrawlClient(api_key=os.environ.get('TEST_API_KEY', 'dummy-api-key-for-testing'))
        
        # Test the HttpClient.post method directly without timeout in data
        client.http_client.post('/v2/scrape', {'url': 'https://example.com'})

        args, kwargs = mock_post.call_args
        self.assertIsNone(kwargs['timeout'])


if __name__ == '__main__':
    unittest.main()
