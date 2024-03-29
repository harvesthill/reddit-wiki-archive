const got = require('got')
const fs = require('fs')
const path = require('path')
const prettifyMarkdown = require('prettify-markdown');
const { Transform } = require('stream');

const cli = require('sywac')
  .positional('<subreddit>', { paramsDesc: 'The subreddit whose wiki we should archive' })
  .boolean('--tidy', { desc: 'Set this flag to run a Markdown beautifier and some custom rules over the wiki data' })
  .boolean('--rewrite-path-relative-wiki-links', { desc: 'Rewrite Markdown links that start with /r/:subName/wiki to be clickable in GitHub' })
  .boolean('--rewrite-web-wiki-links', { desc: 'Rewrite Markdown links that start with https://www.reddit.com/r/:subName/wiki/ to be clickable in GitHub' })
  .help('-h, --help')
  .showHelpByDefault()
  .outputSettings({ maxWidth: 75 })

module.exports = cli

async function main () {
  const argv = await cli.parseAndExit()
  console.log(JSON.stringify(argv, null, 2))
  prepareSubredditFolder(argv.subreddit)
  await fetchPagesForSubreddit(argv.subreddit, argv)
}

if (require.main === module) main()

// Biz logic

async function fetchPagesForSubreddit(sub, argv) {
  const baseUrl = `https://api.reddit.com/r/${sub}/wiki`

  const res = await fetchFromRedditApi(baseUrl + `/pages`)
  
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

    const transformers = getTransformers(
      argv['rewrite-path-relative-wiki-links'],
      argv['rewrite-web-wiki-links'],
      argv.tidy,
      argv.tidy,
    )

    for (const transformer of transformers) {
      content = transformer(sub, targetFile, content)
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

async function fetchFromRedditApi(url) {
  await redditApiThrottle.hit()
  const res = await got(url, {
    headers: {
      'Cookie': 'over18=1; _options={%22pref_gated_sr_optin%22:true}', // https://www.reddit.com/r/redditdev/comments/tjl1c8/bug_gated_subreddits_inaccessible_via_oauth/
    },
  }).json()
  return res
}

function prepareSubredditFolder(subredditName) {
  // Delete and recreate the containing folder, so that we shake off any pages that no longer exist in the target
  if (fs.existsSync(subredditName)) {
    fs.rmSync(subredditName, { recursive: true, force: true })
    fs.mkdirSync(subredditName)
  }
}

function getTransformers(shouldRewritePathRelativeWikiLinks, shouldRewriteWebWikiLinks, shouldCleanUpMarkdownHeaders, shouldCleanUpHtmlEntities) {
  const transformers = [];

  if (shouldRewritePathRelativeWikiLinks) {
    transformers.push(function(subredditName, filePath, chunkString) {
      const searchPattern = new RegExp(`\\]\\(\\/r\\/${subredditName}\\/wiki\\/([^)#?]+)([^)]*)\\)`, 'g');

      return chunkString.replace(searchPattern, function replacer(match, cg1, cg2) {
        return `](/${subredditName}/${cg1}.md${cg2 || ''})`
      });
    })
  }

  if (shouldRewriteWebWikiLinks) {
    transformers.push(function(subredditName, filePath, chunkString) {
      const searchPattern = new RegExp(`\\]\\(https:\\/\\/(?:www\\.)?reddit.com\\/r\\/${subredditName}\\/wiki\\/([^)#?]+)([^)]*)\\)`, 'g');

      return chunkString.replace(searchPattern, function replacer(match, cg1, cg2) {
        return `](/${subredditName}/${cg1}.md${cg2 || ''})`
      });
    })
  }

  if (shouldCleanUpMarkdownHeaders) {
    transformers.push(function(subredditName, filePath, chunkString) {
      const searchPattern = new RegExp(`(^|\\n)(#{1,6})([A-Za-z0-9\\[])`, 'g');

      return chunkString.replace(searchPattern, function replacer(match, cg1, cg2, cg3) {
        return `${cg1}${cg2} ${cg3}`
      });
    })
  }

  if (shouldCleanUpHtmlEntities) {
    transformers.push(function(subredditName, filePath, chunkString) {
      const mappingPattern = new RegExp(`(&amp;|&)(nbsp|amp|quot|lt|gt);`, 'gi');
      const mappings = {
        "nbsp":" ",
        "amp" : "&",
        "quot": "\"",
        "lt"  : "<",
        "gt"  : ">"
      };

      const decodePattern = new RegExp(`&#(\d+);`, `gi`);

      return chunkString
        .replace(mappingPattern, function replacer(match, cg1, cg2) {
          return mappings[cg2.toLowerCase()] || `&${cg1};`
        })
        .replace(decodePattern, function replacer(match, cg1, cg2) {
          var num = parseInt(cg2, 10);
          return String.fromCharCode(num);
        });
    })
  }

  return transformers;
}

// cheap singleton for now
const redditApiThrottle = {
  rpsLimit: 0.15, // as of July 2023, unauthed Reddit API limit is 10 req/min

  lastAcquisition: 0,
  hit() {
    return new Promise((resolve, reject) => {
      const now = Date.now()
      const nextAllowable = this.lastAcquisition + (1000 / this.rpsLimit)

      if(nextAllowable > now) {
        setTimeout(() => {
          resolve()
          this.lastAcquisition = Date.now()
        }, nextAllowable - now)
      } else {
        resolve()
        this.lastAcquisition = Date.now()
      }
    });
  }
}