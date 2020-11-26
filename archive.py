import os
import errno
import requests
import argparse

parser = argparse.ArgumentParser(description='Backs up Reddit wiki content.')
parser.add_argument('subreddit', metavar='sub', type=str, nargs=1,
                   help='the subreddit to archive')

args = parser.parse_args()

base_url = f'https://api.reddit.com/r/{args.subreddit[0]}/wiki'

resp = requests.get(url=f'{base_url}/pages', headers = {'User-Agent': 'wiki-archiver 0.0.1'})
data = resp.json() 

def archive_page(name):
  page_resp = requests.get(url=f'{base_url}/{name}', headers = {'User-Agent': 'wiki-archiver 0.0.1'})
  page_data = page_resp.json()
  md_content = page_data.get('data').get('content_md')

  save_path = f'./{args.subreddit[0]}/{name}.md'

  try:
    dir_target = '/'.join(save_path.split('/')[:-1])
    print(dir_target)
    os.makedirs(dir_target)
  except OSError as exception:
    if exception.errno != errno.EEXIST:
      raise

  with open(save_path, "w") as file:
    file.write(md_content)


for page in data.get('data'):
  archive_page(page)

