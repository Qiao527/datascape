// A hover or keyboard focus on a story plays its real 2D-to-3D film once, then
// returns to the still. One film at a time, fetched only when asked for; touch
// screens, reduced motion and data saver keep the stills.

const DELAY_MS = 180;

export function createPreviews({ reducedMotion, saveData }) {
  if (reducedMotion || saveData) return;
  let active = null;

  function stop(plate) {
    if (!plate) return;
    plate.classList.remove('is-playing');
    plate.querySelector('video')?.pause();
    if (active === plate) active = null;
  }

  function play(plate) {
    if (active === plate) return;
    stop(active);
    active = plate;
    let video = plate.querySelector('video');
    const media = plate.querySelector('.plate-media');
    if (!video) {
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'none';
      video.disablePictureInPicture = true;
      video.setAttribute('aria-hidden', 'true');
      video.tabIndex = -1;
      for (const [extension, type] of [['webm', 'video/webm'], ['mp4', 'video/mp4']]) {
        const source = document.createElement('source');
        source.src = `${plate.dataset.preview}.${extension}`;
        source.type = type;
        video.appendChild(source);
      }
      video.addEventListener('ended', () => stop(plate));
      video.addEventListener('timeupdate', () => {
        media.style.setProperty('--progress', video.duration ? video.currentTime / video.duration : 0);
      });
      video.addEventListener('playing', () => {
        if (active === plate) plate.classList.add('is-playing');
      });
      media.insertBefore(video, media.querySelector('.plate-progress'));
    }
    video.currentTime = 0;
    video.play().catch(() => stop(plate));
  }

  for (const plate of document.querySelectorAll('[data-preview]')) {
    let timer = 0;
    const enter = () => {
      clearTimeout(timer);
      timer = setTimeout(() => play(plate), DELAY_MS);
    };
    const leave = () => {
      clearTimeout(timer);
      stop(plate);
    };
    plate.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') enter();
    });
    plate.addEventListener('pointerleave', leave);
    plate.addEventListener('focus', () => {
      if (plate.matches(':focus-visible')) enter();
    });
    plate.addEventListener('blur', leave);
  }
}
