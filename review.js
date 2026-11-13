(() => {
  const dialog = document.getElementById("answer-summary");
  const summaryButton = document.getElementById("show-summary");
  if (!dialog || !summaryButton) return;

  const counters = [...dialog.querySelectorAll("[data-total]")];
  const list = dialog.querySelector("ul");
  const empty = dialog.querySelector(".summary-empty");

  function renderSummary() {
    const counts = Object.fromEntries(counters.map(counter => [counter.dataset.total, 0]));
    const missed = document.createDocumentFragment();
    for (const card of document.querySelectorAll("[data-review-item]")) {
      const state = card.dataset.reviewState || "unchecked";
      counts[state]++;
      if (state !== "wrong") continue;

      const heading = card.querySelector(".prompt, h2, h3");
      const context = (card.querySelector(".meta, .context") ||
        card.closest("section")?.querySelector(".section-header h2"))?.textContent.trim();
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#" + card.id;
      link.textContent = context
        ? context + " — " + heading.textContent.trim()
        : heading.textContent.trim();
      item.append(link);
      missed.append(item);
    }
    for (const counter of counters) {
      counter.textContent = counts[counter.dataset.total];
    }
    list.replaceChildren(missed);
    list.hidden = counts.wrong === 0;
    empty.hidden = counts.wrong !== 0;
  }

  summaryButton.addEventListener("click", () => {
    renderSummary();
    dialog.showModal();
  });

  list.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const card = document.getElementById(link.hash.slice(1));
    if (!card) return;
    const details = card.closest("details");
    if (details) details.open = true;
    dialog.close();
    card.focus({ preventScroll: true });
  });
})();
