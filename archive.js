// CLI setup

const cli = require('sywac')
  .positional('<subreddit>', { paramsDesc: 'The subreddit whose wiki we should archive' })
  .boolean('--tidy', { desc: 'Set this flag to run a Markdown beautifier over the wiki data' })
  .help('-h, --help')
  .showHelpByDefault()
  .outputSettings({ maxWidth: 75 })

module.exports = cli

async function main () {
  const argv = await cli.parseAndExit()
  console.log(JSON.stringify(argv, null, 2))
  fetchPagesForSubreddit(argv.subreddit, argv)
}

if (require.main === module) main()

// Biz logic

const got = require('got')
const fs = require('fs')
const path = require('path')
const prettifyMarkdown = require('prettify-markdown');

async function fetchPagesForSubreddit(sub, argv) {
  const baseUrl = `https://api.reddit.com/r/${sub}/wiki`
  
  const res = await got(baseUrl + `/pages`).json()
  
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
 const res = await got(url).json()
 
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
