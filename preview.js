const switcher = document.querySelector('.switcher');
const preview = document.querySelector('#app-preview');
const buttons = switcher.querySelectorAll('button');

switcher.hidden = false;

for (const button of buttons) {
  button.addEventListener('click', () => {
    const theme = button.dataset.theme;
    preview.src = `assets/${theme}.png`;
    preview.alt = `ClipDock home screen in ${theme} mode, showing the link field and Library tab`;

    for (const option of buttons) {
      option.setAttribute('aria-pressed', String(option === button));
    }
  });
}
