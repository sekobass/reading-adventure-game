const score=[174.61,220,261.63,220,196,233.08,293.66,233.08,164.81,196,261.63,196,146.83,174.61,220,174.61];

export function music(button) {
  let context, timer, step=0;
  function stop() {
    clearInterval(timer);
    timer=undefined;
    button.setAttribute('aria-pressed','false');
    button.textContent='BGM オフ';
    if (context?.state==='running') context.suspend().catch(()=>{});
  }
  function play() {
    const oscillator=context.createOscillator();
    const gain=context.createGain();
    const time=context.currentTime;
    oscillator.type='triangle';
    oscillator.frequency.value=score[step++%score.length];
    gain.gain.setValueAtTime(.0001,time);
    gain.gain.exponentialRampToValueAtTime(.024,time+.06);
    gain.gain.exponentialRampToValueAtTime(.0001,time+.65);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time+.67);
  }
  button.addEventListener('click',async()=>{
    if (timer) return stop();
    if (!window.AudioContext) return;
    try {
      context ??= new AudioContext();
      await context.resume();
      if (timer || document.hidden) return;
      button.setAttribute('aria-pressed','true');
      button.textContent='BGM オン';
      play();
      timer=setInterval(play,490);
    } catch { stop(); }
  });
  document.addEventListener('visibilitychange',()=>{if (document.hidden) stop();});
}
