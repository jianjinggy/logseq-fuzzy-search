import { buildIndex, search, SearchResult, invalidateIndex, isIndexReady } from './search-engine';

let currentResults: SearchResult[] = [];
let selectedIndex = -1;

function updateSelection(resultsList: HTMLUListElement) {
  const items = resultsList.querySelectorAll('li:not(.no-results)');
  items.forEach((li, i) => {
    li.classList.toggle('selected', i === selectedIndex);
  });
  if (selectedIndex >= 0 && items[selectedIndex]) {
    items[selectedIndex].scrollIntoView({ block: 'nearest' });
  }
}

function openResult(result: SearchResult) {
  if (result.kind === 'page' || !result.uuid) {
    logseq.App.pushState('page', { name: result.pageName });
  } else {
    logseq.Editor.scrollToBlockInPage(result.pageName, result.uuid);
  }
  logseq.hideMainUI();
}

function renderResults(resultsList: HTMLUListElement) {
  resultsList.innerHTML = '';

  if (currentResults.length === 0) {
    const li = document.createElement('li');
    li.className = 'no-results';
    li.textContent = 'No results found';
    resultsList.appendChild(li);
    return;
  }

  for (const hit of currentResults) {
    const li = document.createElement('li');

    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = hit.pageName;

    const snippet = document.createElement('div');
    snippet.className = 'result-snippet';
    snippet.textContent = hit.content
      ? hit.content.slice(0, 140)
      : (hit.kind === 'page' ? 'Page title match' : '');

    li.appendChild(title);
    li.appendChild(snippet);

    li.addEventListener('click', () => openResult(hit));
    resultsList.appendChild(li);
  }
}

async function createSearchUI() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  currentResults = [];
  selectedIndex = -1;

  if (!isIndexReady()) {
    const loading = document.createElement('div');
    loading.className = 'no-results';
    loading.textContent = 'Indexing pages...';
    app.appendChild(loading);
    await buildIndex();
    app.removeChild(loading);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search notes...';
  input.id = 'search-input';

  const controls = document.createElement('div');
  controls.id = 'search-controls';

  const inputWrap = document.createElement('div');
  inputWrap.id = 'search-input-wrap';
  inputWrap.appendChild(input);

  const titleToggle = document.createElement('label');
  titleToggle.id = 'search-mode-toggle';

  const titleOnlyCheckbox = document.createElement('input');
  titleOnlyCheckbox.type = 'checkbox';
  titleOnlyCheckbox.id = 'title-only-toggle';

  const titleToggleText = document.createElement('span');
  titleToggleText.textContent = 'Title only';

  titleToggle.appendChild(titleOnlyCheckbox);
  titleToggle.appendChild(titleToggleText);

  controls.appendChild(inputWrap);
  controls.appendChild(titleToggle);

  const resultsList = document.createElement('ul');
  resultsList.id = 'results-list';

  let debounceTimer: ReturnType<typeof setTimeout>;

  const runSearch = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = input.value.trim();
      currentResults = [];
      selectedIndex = -1;

      if (!query) {
        resultsList.innerHTML = '';
        return;
      }

      currentResults = search(query, { titleOnly: titleOnlyCheckbox.checked });
      renderResults(resultsList);
    }, 150);
  };

  input.addEventListener('input', runSearch);
  titleOnlyCheckbox.addEventListener('change', runSearch);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      if (currentResults.length === 0) return;
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
      updateSelection(resultsList);
    } else if (e.key === 'ArrowUp') {
      if (currentResults.length === 0) return;
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelection(resultsList);
    } else if (e.key === 'Enter') {
      if (currentResults.length === 0) return;
      e.preventDefault();
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      openResult(currentResults[idx]);
    }
  });

  app.appendChild(controls);
  app.appendChild(resultsList);

  setTimeout(() => input.focus(), 100);
}

async function applyTheme(mode?: string) {
  if (!mode) {
    const config = await logseq.App.getUserConfigs();
    mode = config.preferredThemeMode;
  }
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

function main() {
  logseq.setMainUIInlineStyle({
    zIndex: 999,
  });

  applyTheme();
  logseq.App.onThemeModeChanged(({ mode }: { mode: string }) => {
    applyTheme(mode);
  });

  logseq.App.registerCommandPalette({
    key: 'open-search',
    label: 'Open Fuzzy Search',
    keybinding: { binding: 'mod+shift+s' }
  }, async () => {
    await createSearchUI();
    logseq.showMainUI({ autoFocus: true });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      logseq.hideMainUI();
    }
  });

  const overlay = document.getElementById('search-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        logseq.hideMainUI();
      }
    });
  }

  logseq.DB.onChanged(() => {
    invalidateIndex();
  });

  buildIndex();
}

logseq.ready(main).catch(console.error);
