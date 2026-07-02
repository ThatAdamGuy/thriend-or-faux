// Click-to-enlarge lightbox for .tof-zoom-trigger buttons (see index.html "See it in action")

function initLightbox() {
  const triggers = document.querySelectorAll(".tof-zoom-trigger");
  if (!triggers.length) return;

  const overlay = document.createElement("div");
  overlay.className = "tof-lightbox-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <button type="button" class="tof-lightbox-close" aria-label="Close">×</button>
    <img alt="">
  `;
  document.body.appendChild(overlay);

  const img      = overlay.querySelector("img");
  const closeBtn = overlay.querySelector(".tof-lightbox-close");
  let lastFocused = null;

  function open(src, alt) {
    lastFocused = document.activeElement;
    img.src = src;
    img.alt = alt || "";
    overlay.classList.add("tof-open");
    document.body.style.overflow = "hidden";
    closeBtn.focus();
  }

  function close() {
    overlay.classList.remove("tof-open");
    document.body.style.overflow = "";
    img.src = "";
    if (lastFocused) lastFocused.focus();
  }

  triggers.forEach((btn) => {
    btn.addEventListener("click", () => {
      const thumb = btn.querySelector("img");
      if (thumb) open(thumb.src, thumb.alt);
    });
  });

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("tof-open")) close();
  });
}

initLightbox();
