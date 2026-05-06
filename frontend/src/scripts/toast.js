function showToast(message, type = 'info') {
  let toastBox = document.getElementById('toastBox');
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.id = 'toastBox';
    toastBox.setAttribute('aria-live', 'polite');
    toastBox.setAttribute('aria-atomic', 'false');
    document.body.appendChild(toastBox);
  }

  const toast = document.createElement('div');
  toast.classList.add('toast', type);
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  toastBox.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => {
      toast.remove();
      if (!toastBox.children.length) toastBox.remove();
    }, { once: true });
  }, 4200);
}

