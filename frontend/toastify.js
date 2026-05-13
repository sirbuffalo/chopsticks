(function () {
  function Toastify(options = {}) {
    const settings = {
      text: "",
      duration: 3000,
      gravity: "top",
      position: "right",
      className: "",
      stopOnFocus: true,
      onClick: null,
      callback: null,
      ...options,
    };

    let toastElement = null;
    let hideTimer = null;

    function clearTimer() {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    }

    function removeToast() {
      clearTimer();
      if (toastElement === null) {
        return;
      }

      const removedToast = toastElement;
      toastElement = null;
      removedToast.classList.remove("on");
      window.setTimeout(() => {
        removedToast.remove();
        settings.callback?.();
      }, 180);
    }

    function showToast() {
      removeToast();

      toastElement = document.createElement("div");
      toastElement.className = ["toastify", settings.className]
        .filter(Boolean)
        .join(" ");
      toastElement.setAttribute("role", "status");
      toastElement.setAttribute("aria-live", "polite");
      toastElement.dataset.gravity = settings.gravity;
      toastElement.dataset.position = settings.position;

      if (settings.node !== undefined) {
        toastElement.replaceChildren(settings.node);
      } else {
        toastElement.textContent = settings.text;
      }

      if (settings.onClick !== null) {
        toastElement.addEventListener("click", settings.onClick);
      }

      if (settings.stopOnFocus) {
        toastElement.addEventListener("mouseenter", clearTimer);
        toastElement.addEventListener("mouseleave", startTimer);
      }

      document.body.append(toastElement);
      window.requestAnimationFrame(() => toastElement?.classList.add("on"));
      startTimer();

      return api;
    }

    function startTimer() {
      clearTimer();
      if (settings.duration > 0) {
        hideTimer = window.setTimeout(removeToast, settings.duration);
      }
    }

    const api = {
      showToast,
      hideToast: removeToast,
    };

    return api;
  }

  window.Toastify = Toastify;
})();
