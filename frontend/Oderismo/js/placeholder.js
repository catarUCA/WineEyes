export function renderPlaceholder(container, { title, description }) {
  container.innerHTML = `
    <div class="app-page">
      <div class="app-placeholder">
        <h2 class="app-page-title">${title}</h2>
        <p class="app-placeholder-text">${description}</p>
      </div>
    </div>
  `;
}
