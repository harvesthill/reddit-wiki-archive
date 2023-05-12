const got = require('got')
const fs = require('fs')
const path = require('path')
const prettifyMarkdown = require('prettify-markdown');
const { Transform } = require('stream');

const cli = require('sywac')
  .positional('<subreddit>', { paramsDesc: 'The subreddit whose wiki we should archive' })
  .boolean('--tidy', { desc: 'Set this flag to run a Markdown beautifier over the wiki data' })
  .boolean('--rewrite-path-relative-wiki-links', { desc: 'Rewrite Markdown links that start with /r/:subName/wiki to be clickable in GitHub' })
  .boolean('--rewrite-web-wiki-links', { desc: 'Rewrite Markdown links that start with https://www.reddit.com/r/:subName/wiki/ to be clickable in GitHub' })
  .help('-h, --help')
  .showHelpByDefault()
  .outputSettings({ maxWidth: 75 })

module.exports = cli

async function main () {
  const argv = await cli.parseAndExit()
  console.log(JSON.stringify(argv, null, 2))
  // prepareSubredditFolder(argv.subreddit)
  // fetchPagesForSubreddit(argv.subreddit, argv)
  await runPostprocessTransformations(argv.subreddit, argv['rewrite-path-relative-wiki-links'], argv['rewrite-web-wiki-links'])
}

if (require.main === module) main()

// Biz logic

async function fetchPagesForSubreddit(sub, argv) {
  const baseUrl = `https://api.reddit.com/r/${sub}/wiki`

  const res = await fetchFromRedditApi(baseUrl + `/pages`).json()
  
  if (res && res.data && res.data.length > 0) {
    for (let page of res.data) {
      await archivePage(`${baseUrl}/${page}`, page, sub, argv)
    }
  } else {
    console.error('Error: did not get any pages to archive from the Reddit API.')
    process.exit(1)
  }
}

async function archivePage(url, pageSlug, sub, argv) {
 const res = await fetchFromRedditApi(url)
  if(res.data && res.data.content_md !== undefined) {
    const targetFile = `${sub}/${pageSlug}.md`
    ensureParentDirForFilePath(targetFile)

    let content
    if(argv.tidy) {
      content = prettifyMarkdown(res.data.content_md)
    } else {
      content = res.data.content_md
    }

    fs.writeFileSync(targetFile, content)
  } else {
    console.error(`Error: unable to fetch page ${pageSlug}`)
    console.error('Result from Reddit was:', res)
    process.exit(1)
  }
}

function ensureParentDirForFilePath(filePath) {
  const parentDir = path.dirname(filePath)

  try {
    fs.mkdirSync(parentDir)
  } catch(e) {
    if (e.code === 'EEXIST') return
    throw e
  }
}

function fetchFromRedditApi(url) {
  return got(url, {
    headers: {
      'Cookie': 'over18=1; _options={%22pref_gated_sr_optin%22:true}', // https://www.reddit.com/r/redditdev/comments/tjl1c8/bug_gated_subreddits_inaccessible_via_oauth/
    },
  }).json()
}

function prepareSubredditFolder(subredditName) {
  // Delete and recreate the containing folder, so that we shake off any pages that no longer exist in the target
  if (fs.existsSync(subredditName)) {
    fs.rmSync(subredditName, { recursive: true, force: true })
    fs.mkdirSync(subredditName)
  }
}

async function runPostprocessTransformations(subredditName, shouldRewritePathRelativeWikiLinks, shouldRewriteWebWikiLinks) {
  const transformers = getTransformers(shouldRewritePathRelativeWikiLinks, shouldRewriteWebWikiLinks);

  await readdirRecursive(subredditName, async function(file, filePath) {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(filePath);
      const writeStream = fs.createWriteStream(filePath + '.tmp');
  
      const transformStream = new Transform({
        transform(chunk, encoding, callback) {
          const modifiedChunk = transformers.reduce((chunkString, transformer) => transformer(subredditName, file, filePath, chunkString), chunk.toString())
          callback(null, modifiedChunk);
        }
      });
  
      readStream.pipe(transformStream).pipe(writeStream);
  
      writeStream.on('finish', () => {
        fs.renameSync(filePath + '.tmp', filePath);
        resolve();
      });
    })
  })
}

function getTransformers(shouldRewritePathRelativeWikiLinks, shouldRewriteWebWikiLinks) {
  const transformers = [];

  if (shouldRewritePathRelativeWikiLinks) {
    transformers.push(function(subredditName, file, filePath, chunkString) {
      const searchPattern = new RegExp(`\\]\\(\\/r\\/${subredditName}\\/wiki\\/([^)#?]+)(.*)\\)`, 'g');

      return chunkString.replace(searchPattern, function replacer(match, cg1, cg2) {
        return `](/${subredditName}/${cg1}.md${cg2 || ''})`
      });
    })
  }

  if (shouldRewriteWebWikiLinks) {
    transformers.push(function(subredditName, file, filePath, chunkString) {
      const searchPattern = new RegExp(`\\]\\(https:\\/\\/(?:www\\.)?reddit.com\\/r\\/${subredditName}\\/wiki\\/([^)#?]+)(.*)\\)`, 'g');

      return chunkString.replace(searchPattern, function replacer(match, cg1, cg2) {
        return `](/${subredditName}/${cg1}.md${cg2 || ''})`
      });
    })
  }

  return transformers;
}

async function readdirRecursive(dir, fileCallback) {
  let files = fs.readdirSync(dir);

  for (const file of files) {
    let filePath = path.join(dir, file);
    let stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      readdirRecursive(filePath, fileCallback);
    } else {
      await fileCallback(file, filePath);
    }
  }
}