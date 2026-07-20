if (window.lucide) {
  window.lucide.createIcons({
    attrs: {
      "aria-hidden": "true",
    },
  });
}

const focus = new URLSearchParams(window.location.search).get("focus");
if (["a", "b", "c"].includes(focus)) {
  document.body.classList.add("focus-mode", `focus-${focus}`);
}

const toast = document.querySelector(".review-toast");
let toastTimer;

document.querySelectorAll(".phone button").forEach((button) => {
  button.addEventListener("click", () => {
    const label =
      button.getAttribute("aria-label") ||
      button.querySelector("small")?.textContent ||
      button.textContent.trim();

    if (!toast || !label) return;

    window.clearTimeout(toastTimer);
    toast.textContent = `${label} · 设计预览交互`;
    toast.classList.add("visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1400);
  });
});
