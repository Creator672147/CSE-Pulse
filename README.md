[README.md](https://github.com/user-attachments/files/34069205/README.md)
# CSE Pulse daily news

Every morning at 08:00 Colombo time, GitHub runs `scripts/update-news.mjs`. It reads Daily FT, Lanka Business Online, IPS, Economy.lk and Bloomberg through Firecrawl, labels each story Local or Global, groups the same story from different sites, and saves the result to `docs/news.json`. The page in `docs/index.html` shows it.

## Set up (about 10 minutes)

1. Create a new **public** repository on GitHub (free Pages hosting needs a public repository).
2. Add these files to it, keeping the folders:
   - `docs/index.html`
   - `docs/news.json`
   - `scripts/update-news.mjs`
   - `.github/workflows/daily-news.yml` (if your upload skips the hidden `.github` folder, use Add file > Create new file, type `.github/workflows/daily-news.yml` as the name and paste the contents)
3. In the repository go to Settings > Secrets and variables > Actions > New repository secret. Name it `FIRECRAWL_API_KEY` and paste your Firecrawl key.
4. Go to Settings > Actions > General > Workflow permissions and choose **Read and write permissions**.
5. Go to Settings > Pages. Under Build and deployment choose Deploy from a branch, branch `main`, folder `/docs`. Your page address appears there after a minute.
6. Go to the Actions tab, open "Daily CSE Pulse news" and press Run workflow to test it. A green tick means `docs/news.json` was refreshed.

## Notes

- Each run uses 5 Firecrawl scrapes.
- If one site fails, the page keeps that site's earlier stories and says so. If every site fails, the file is left as it was.
- Duplicates are merged only when one headline's meaningful words are all contained in the other. Different companies with similar headlines stay separate, but the same story worded very differently on two sites can appear twice.
- Stories older than 21 days are dropped. Sites that do not show dates fall back to today's date.
- Edit the `SOURCES` list at the top of `scripts/update-news.mjs` to add or remove sites.
- Information only, not investment advice.
