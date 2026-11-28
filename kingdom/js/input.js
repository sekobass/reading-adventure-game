const directions = {
  ArrowUp: [0,-1], KeyW: [0,-1], ArrowDown: [0,1], KeyS: [0,1],
  ArrowLeft: [-1,0], KeyA: [-1,0], ArrowRight: [1,0], KeyD: [1,0],
};
const actions = {
  Space:'attack', KeyQ:'cast', KeyE:'interact', KeyR:'journal', Escape:'pause',
  Digit1:'slot0', Digit2:'slot1', Digit3:'slot2', Digit4:'slot3',
  KeyG:'strong', KeyH:'heal', KeyF:'guard', ShiftLeft:'dodge', ShiftRight:'dodge',
};

export function input({ playable, action }) {
  const keys = new Set();
  const attackPointers = new Set();
  const stick = document.querySelector('#joystick');
  let joyId = null;
  let vector = [0,0];

  function resetStick() {
    joyId = null;
    vector = [0,0];
    stick.style.setProperty('--joy-x','0px');
    stick.style.setProperty('--joy-y','0px');
  }

  function clear() {
    keys.clear();
    attackPointers.clear();
    resetStick();
  }

  window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',clear);
  window.addEventListener('keydown', event => {
    if (!playable() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!directions[event.code] && !actions[event.code]) return;
    event.preventDefault();
    keys.add(event.code);
    if (!event.repeat && actions[event.code]) action(actions[event.code]);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));

  function reposition(event) {
    const rect = stick.getBoundingClientRect();
    let dx = event.clientX - rect.left - rect.width/2;
    let dy = event.clientY - rect.top - rect.height/2;
    const radius = rect.width * .33;
    const ratio = Math.max(1, Math.hypot(dx,dy)/radius);
    dx /= ratio;
    dy /= ratio;
    vector = [dx / radius, dy / radius];
    stick.style.setProperty('--joy-x',dx+'px');
    stick.style.setProperty('--joy-y',dy+'px');
  }

  stick.addEventListener('pointerdown',event => {
    if (!playable() || joyId !== null) return;
    event.preventDefault();
    joyId = event.pointerId;
    stick.setPointerCapture(joyId);
    reposition(event);
  });
  stick.addEventListener('pointermove',event => {
    if (event.pointerId === joyId) reposition(event);
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) {
    stick.addEventListener(name,event => {
      if (event.pointerId === joyId) resetStick();
    });
  }

  for (const button of document.querySelectorAll('[data-action]')) {
    // Interaction can open a dialog. Let the button click finish before the
    // dialog replaces its target so that the touch does not select an answer.
    if (button.dataset.action==='interact') {
      button.addEventListener('click',()=>{if (playable()) action('interact');});
      continue;
    }
    button.addEventListener('pointerdown',event => {
      if (!playable()) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      if (button.dataset.action === 'attack') attackPointers.add(event.pointerId);
      action(button.dataset.action);
    });
    button.addEventListener('click',event => {
      if (event.detail === 0 && playable()) action(button.dataset.action);
    });
    for (const name of ['pointerup','pointercancel','lostpointercapture']) {
      button.addEventListener(name,event=>attackPointers.delete(event.pointerId));
    }
  }
  return {
    clear,
    movement() {
      const [tx,ty] = vector;
      let x = tx, y = ty;
      for (const key of keys) {
        const axis = directions[key];
        if (axis) {
          x += axis[0];
          y += axis[1];
        }
      }
      return [x,y];
    },
    attacking: () => keys.has('Space') || attackPointers.size > 0,
  };
}
