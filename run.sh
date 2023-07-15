node archive.js --rewrite-path-relative-wiki-links --rewrite-web-wiki-links --tidy steroids

find . -type f -name 'index.md' -exec sh -c '
  for file do
    ln -s "$file" "$(dirname "$file")/README.md"
  done
' sh {} +
