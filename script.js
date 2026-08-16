(function () {
  const video = document.getElementById("video");
  const stillImg = document.getElementById("stillImg");
  const placeholder = document.getElementById("placeholder");
  const workCanvas = document.getElementById("workCanvas");
  const flashOverlay = document.getElementById("flashOverlay");
  const toast = document.getElementById("toast");
  const shutterBtn = document.getElementById("shutterBtn");
  const flashToggleBtn = document.getElementById("flashToggleBtn");
  const switchCameraBtn = document.getElementById("switchCameraBtn");
  const filterRow = document.getElementById("filterRow");
  const filmstrip = document.getElementById("filmstrip");
  const galleryPeekBtn = document.getElementById("galleryPeekBtn");
  const uploadBtn = document.getElementById("uploadBtn");
  const fileInput = document.getElementById("fileInput");
  const shellRow = document.getElementById("shellRow");
  const hudCounter = document.getElementById("hudCounter");
  const hudDate = document.getElementById("hudDate");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lbDownload = document.getElementById("lbDownload");
  const lbDelete = document.getElementById("lbDelete");
  const lbClose = document.getElementById("lbClose");
  const lbPrev = document.getElementById("lbPrev");
  const lbNext = document.getElementById("lbNext");
  const lbPosition = document.getElementById("lbPosition");

  let cameraReady = false;
  let currentFilter = "cybershot";
  let flashOn = false;
  let frameCount = 24;
  let photos = []; // {id, dataURL}
  let currentLightboxId = null;

  // ---------- date HUD ----------
  const d = new Date();
  hudDate.textContent =
    "'" +
    String(d.getFullYear()).slice(2) +
    " " +
    (d.getMonth() + 1) +
    " " +
    d.getDate();

  // ---------- camera ----------

  let isFrontFacing = false;
  let currentFacingMode = "environment";
  let currentStream = null;

  async function initCamera() {
    // Stop previous camera stream
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API unavailable");
      }

      const constraints = {
        video: {
          facingMode: {
            ideal: currentFacingMode,
          },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      currentStream = stream;
      video.srcObject = stream;

      cameraReady = true;

      placeholder.style.display = "none";
      video.style.display = "block";
      stillImg.style.display = "none";

      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings ? track.getSettings() : {};

      isFrontFacing =
        settings.facingMode === "user" || currentFacingMode === "user";

      // Mirror selfie camera
      video.style.transform = isFrontFacing ? "scaleX(-1)" : "none";
    } catch (err) {
      console.error("Camera initialization failed:", err);

      cameraReady = false;
      currentStream = null;

      placeholder.style.display = "block";
      video.style.display = "none";

      showToast("camera unavailable 😖");
    }
  }

  // Switch camera
  async function switchCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast("camera switching unavailable 😖");
      return;
    }

    currentFacingMode =
      currentFacingMode === "environment" ? "user" : "environment";

    switchCameraBtn.disabled = true;

    await initCamera();

    switchCameraBtn.disabled = false;

    showToast(
      currentFacingMode === "user" ? "front camera 🤳" : "rear camera 📷",
    );
  }

  switchCameraBtn.addEventListener("click", switchCamera);

  // Start camera once
  initCamera();

  // ---------- helpers ----------
  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }
  function contrast(v, factor) {
    return (v - 128) * factor + 128;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function drawCover(ctx, source, sw, sh, dw, dh, flipH) {
    const sr = sw / sh,
      dr = dw / dh;
    let cw, ch, cx, cy;
    if (sr > dr) {
      ch = sh;
      cw = sh * dr;
      cx = (sw - cw) / 2;
      cy = 0;
    } else {
      cw = sw;
      ch = sw / dr;
      cx = 0;
      cy = (sh - ch) / 2;
    }
    if (flipH) {
      ctx.save();
      ctx.translate(dw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, cx, cy, cw, ch, 0, 0, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(source, cx, cy, cw, ch, 0, 0, dw, dh);
    }
  }

  // cheap soft-focus blur via downscale/upscale (mimics a plasticky CCD-era lens)
  function softBlur(ctx, w, h, amount) {
    if (amount <= 0) return;
    const scale = Math.max(0.12, 1 - amount);
    const tw = Math.max(1, Math.round(w * scale)),
      th = Math.max(1, Math.round(h * scale));
    const tmp = document.createElement("canvas");
    tmp.width = tw;
    tmp.height = th;
    const tctx = tmp.getContext("2d");
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0, tw, th, 0, 0, w, h);
  }

  // shifts red/blue channels apart from green for a cheap-lens chromatic-aberration fringe
  function chromaShift(ctx, w, h, dx) {
    if (dx <= 0) return;
    const src = ctx.getImageData(0, 0, w, h);
    const s = src.data;
    const out = ctx.createImageData(w, h);
    const o = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const xr = Math.min(w - 1, Math.max(0, x - dx));
        const xb = Math.min(w - 1, Math.max(0, x + dx));
        const ir = (y * w + xr) * 4,
          ib = (y * w + xb) * 4;
        o[i] = s[ir]; // red sampled shifted left
        o[i + 1] = s[i + 1]; // green stays put
        o[i + 2] = s[ib + 2]; // blue sampled shifted right
        o[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  function applyFilter(ctx, w, h, filterName, flash) {
    // preset recipes tuned to feel like a specific film/camera, not a subtle tweak
    let recipe;
    if (filterName === "cybershot")
      recipe = {
        blur: 0.22,
        ca: 1,
        grain: 22,
        lift: 14,
        warmR: 22,
        warmG: 6,
        warmB: -14,
        cFactor: 1.28,
        sat: 1.18,
        vAlpha: 0.42,
        vRadius: 0.62,
      };
    else if (filterName === "y2kflash")
      recipe = {
        blur: 0.04,
        ca: 0,
        grain: 16,
        lift: 0,
        warmR: -18,
        warmG: -4,
        warmB: 30,
        cFactor: 1.6,
        sat: 0.95,
        vAlpha: 0.7,
        vRadius: 0.42,
      };
    else if (filterName === "vhs")
      recipe = {
        blur: 0.16,
        ca: 2,
        grain: 18,
        lift: 10,
        warmR: -4,
        warmG: 10,
        warmB: 6,
        cFactor: 1.15,
        sat: 0.85,
        vAlpha: 0.26,
        vRadius: 0.78,
      };
    else
      recipe = {
        blur: 0.22,
        ca: 1,
        grain: 32,
        lift: 6,
        warmR: 26,
        warmG: 10,
        warmB: -4,
        cFactor: 1.08,
        sat: 1.28,
        vAlpha: 0.3,
        vRadius: 0.72,
      }; // disposable

    softBlur(ctx, w, h, recipe.blur);
    chromaShift(ctx, w, h, recipe.ca);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i],
        g = data[i + 1],
        b = data[i + 2];

      // saturation push/pull around luma
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      r = luma + (r - luma) * recipe.sat;
      g = luma + (g - luma) * recipe.sat;
      b = luma + (b - luma) * recipe.sat;

      // lifted blacks (faded film look) + contrast + color cast
      r =
        contrast(r, recipe.cFactor) +
        recipe.warmR +
        recipe.lift * (1 - r / 255) * 0.4;
      g =
        contrast(g, recipe.cFactor) +
        recipe.warmG +
        recipe.lift * (1 - g / 255) * 0.4;
      b =
        contrast(b, recipe.cFactor) +
        recipe.warmB +
        recipe.lift * (1 - b / 255) * 0.4;

      if (flash) {
        r += 22;
        g += 18;
        b += 14;
      }

      const n = (Math.random() - 0.5) * recipe.grain;
      r += n;
      g += n;
      b += n;
      data[i] = clamp(r);
      data[i + 1] = clamp(g);
      data[i + 2] = clamp(b);
    }
    ctx.putImageData(imgData, 0, 0);

    // tight, heavy vignette
    const vg = ctx.createRadialGradient(
      w / 2,
      h / 2,
      h * 0.18,
      w / 2,
      h / 2,
      h * recipe.vRadius,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0," + recipe.vAlpha + ")");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    if (filterName === "vhs") {
      ctx.fillStyle = "rgba(0,0,0,0.11)";
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 2);
      }
    }

    // glowing light leak (screen blend) — warm corner accent for disposable + cybershot
    if (filterName === "disposable" || filterName === "cybershot") {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const leakR = filterName === "disposable" ? 0.4 : 0.55;
      const leakStrength = filterName === "disposable" ? 0.5 : 0.5;
      const lg = ctx.createRadialGradient(
        w * 0.06,
        h * 0.04,
        0,
        w * 0.06,
        h * 0.04,
        w * leakR,
      );
      const leakColor =
        filterName === "disposable" ? "255,150,70" : "255,190,120";
      lg.addColorStop(0, "rgba(" + leakColor + "," + leakStrength + ")");
      lg.addColorStop(1, "rgba(" + leakColor + ",0)");
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // soft central glow for the flash filter — mimics on-camera flash falloff
    // instead of a single corner hotspot, brightening the frame center paired
    // with the tight vignette above reads as a real direct-flash exposure
    if (filterName === "y2kflash") {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const fg = ctx.createRadialGradient(
        w * 0.5,
        h * 0.42,
        0,
        w * 0.5,
        h * 0.42,
        w * 0.55,
      );
      fg.addColorStop(0, "rgba(255,255,255,0.28)");
      fg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // bold timestamp burn-in, digicam-style
    const dt = new Date();
    const stamp =
      "'" +
      String(dt.getFullYear()).slice(2) +
      " " +
      (dt.getMonth() + 1) +
      " " +
      dt.getDate();
    ctx.font = Math.round(h * 0.07) + "px 'VT323', monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillText(stamp, w - 14 + 2, h - 16 + 2);
    ctx.fillStyle = "#FF9F1C";
    ctx.fillText(stamp, w - 14, h - 16);
  }

  function processAndSave(sourceEl, sw, sh, flipH) {
    try {
      const W = 800,
        H = 600;
      workCanvas.width = W;
      workCanvas.height = H;
      const ctx = workCanvas.getContext("2d");
      drawCover(ctx, sourceEl, sw, sh, W, H, !!flipH);
      applyFilter(ctx, W, H, currentFilter, flashOn);
      const dataURL = workCanvas.toDataURL("image/jpeg", 0.9);

      // show the filtered result front and center so the effect is obvious
      video.style.display = "none";
      placeholder.style.display = "none";
      stillImg.src = dataURL;
      stillImg.style.display = "block";
      shootAgainBtn.style.display = "block";
      saveGalleryBtn.style.display = "block";
      lastCapturedDataURL = dataURL;

      savePhoto(dataURL);
      doFlashAnim();
      showToast("saved! (" + currentFilter + ")");
      frameCount = frameCount > 1 ? frameCount - 1 : 24;
      hudCounter.textContent = frameCount;
    } catch (err) {
      console.error("capture failed", err);
      showToast("couldn't process that photo 😖");
    }
  }

  const shootAgainBtn = document.getElementById("shootAgainBtn");
  const saveGalleryBtn = document.getElementById("saveGalleryBtn");
  let lastCapturedDataURL = null;

  saveGalleryBtn.addEventListener("click", async () => {
    if (!lastCapturedDataURL) return;
    const filename = "mochicam-" + Date.now() + ".jpg";
    const shared = await saveToDeviceGallery(lastCapturedDataURL, filename);
    showToast(
      shared
        ? 'pick "save" in the share sheet!'
        : "sharing isn't supported here — use download instead",
    );
  });

  function backToLiveView() {
    stillImg.style.display = "none";
    shootAgainBtn.style.display = "none";
    saveGalleryBtn.style.display = "none";
    if (cameraReady) {
      video.style.display = "block";
    } else {
      placeholder.style.display = "block";
    }
  }
  shootAgainBtn.addEventListener("click", backToLiveView);
  // tapping the viewfinder while showing a still also returns to live/placeholder view
  document.getElementById("viewfinder").addEventListener("click", (e) => {
    if (stillImg.style.display === "block" && e.target !== shootAgainBtn) {
      backToLiveView();
    }
  });

  function doFlashAnim() {
    flashOverlay.classList.remove("go");
    void flashOverlay.offsetWidth;
    flashOverlay.classList.add("go");
  }
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1100);
  }

  // ---------- capture ----------
  shutterBtn.addEventListener("click", () => {
    if (cameraReady && video.videoWidth) {
      processAndSave(video, video.videoWidth, video.videoHeight, isFrontFacing);
    } else {
      fileInput.click();
    }
  });

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      const img = new Image();
      img.onload = function () {
        processAndSave(img, img.naturalWidth, img.naturalHeight);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    fileInput.value = "";
  });

  flashToggleBtn.addEventListener("click", () => {
    flashOn = !flashOn;
    flashToggleBtn.classList.toggle("on", flashOn);
  });

  filterRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    [...filterRow.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
  });

  shellRow.addEventListener("click", (e) => {
    const sw = e.target.closest(".swatch");
    if (!sw) return;
    const [shell, dark, shine] = sw.dataset.shell.split("|");
    document.documentElement.style.setProperty("--shell", shell);
    document.documentElement.style.setProperty("--shell-dark", dark);
    document.documentElement.style.setProperty("--shell-shine", shine);
    [...shellRow.children].forEach((c) => c.classList.remove("active"));
    sw.classList.add("active");
  });

  // ---------- gallery ----------
  function renderFilmstrip() {
    filmstrip.innerHTML = "";
    if (photos.length === 0) {
      filmstrip.innerHTML =
        '<span class="film-empty">no shots yet — your gallery will fill up here 🌸</span>';
      galleryPeekBtn.style.backgroundImage = "";
      return;
    }
    photos.forEach((p) => {
      const div = document.createElement("div");
      div.className = "film-thumb";
      div.innerHTML = '<img src="' + p.dataURL + '" alt="shot">';
      div.addEventListener("click", () => openLightbox(p.id));
      filmstrip.appendChild(div);
    });
    galleryPeekBtn.innerHTML =
      '<img src="' +
      photos[0].dataURL +
      '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
  }

  function openLightbox(id) {
    const p = photos.find((x) => x.id === id);
    if (!p) return;
    currentLightboxId = id;
    lightboxImg.src = p.dataURL;
    lightbox.classList.add("open");
    updateLightboxNav();
  }
  function updateLightboxNav() {
    const idx = photos.findIndex((x) => x.id === currentLightboxId);
    lbPosition.textContent = idx + 1 + " / " + photos.length;
    lbPrev.disabled = idx <= 0;
    lbNext.disabled = idx >= photos.length - 1;
  }
  function showLightboxAt(idx) {
    if (idx < 0 || idx >= photos.length) return;
    currentLightboxId = photos[idx].id;
    lightboxImg.src = photos[idx].dataURL;
    updateLightboxNav();
  }
  lbPrev.addEventListener("click", () => {
    const idx = photos.findIndex((x) => x.id === currentLightboxId);
    showLightboxAt(idx - 1);
  });
  lbNext.addEventListener("click", () => {
    const idx = photos.findIndex((x) => x.id === currentLightboxId);
    showLightboxAt(idx + 1);
  });
  function closeLightbox() {
    lightbox.classList.remove("open");
    currentLightboxId = null;
  }
  lbClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  // ---------- storage: window.storage when running inside the Claude.ai
  // artifact frame; otherwise IndexedDB, which is the correct browser API
  // for persisting images (localStorage's ~5-10MB quota gets blown through
  // by a handful of JPEGs, which silently breaks saving) ----------
  const hostStorage =
    typeof window !== "undefined" && window.storage ? window.storage : null;
  let storageBroken = false;

  // asks the browser not to evict this site's storage under pressure —
  // the real permission step for "keep my photos after I close the app"
  async function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        console.log("persistent storage granted:", granted);
      }
    } catch (e) {
      console.error("persist() request failed", e);
    }
  }

  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("no indexedDB"));
        return;
      }
      const req = indexedDB.open("mochicam-db", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("photos", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function storeSet(key, value, shared) {
    if (hostStorage) {
      try {
        return await hostStorage.set(key, value, shared);
      } catch (e) {
        console.error("host storage set failed", e);
      }
    }
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readwrite");
        tx.objectStore("photos").put({ key, value, shared });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return { key, value, shared };
    } catch (e) {
      console.error("indexedDB set failed", e);
      storageBroken = true;
      return null;
    }
  }
  async function storeGet(key, shared) {
    if (hostStorage) {
      try {
        return await hostStorage.get(key, shared);
      } catch (e) {
        return null;
      }
    }
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readonly");
        const req = tx.objectStore("photos").get(key);
        req.onsuccess = () =>
          resolve(req.result ? { key, value: req.result.value, shared } : null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return null;
    }
  }
  async function storeDelete(key, shared) {
    if (hostStorage) {
      try {
        return await hostStorage.delete(key, shared);
      } catch (e) {
        return null;
      }
    }
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readwrite");
        tx.objectStore("photos").delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return { key, deleted: true, shared };
    } catch (e) {
      return null;
    }
  }
  async function storeList(prefix, shared) {
    if (hostStorage) {
      try {
        return await hostStorage.list(prefix, shared);
      } catch (e) {
        return null;
      }
    }
    try {
      const db = await openDB();
      const keys = await new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readonly");
        const req = tx.objectStore("photos").getAllKeys();
        req.onsuccess = () =>
          resolve(
            req.result.filter(
              (k) => typeof k === "string" && k.indexOf(prefix) === 0,
            ),
          );
        req.onerror = () => reject(req.error);
      });
      return { keys, prefix, shared };
    } catch (e) {
      return null;
    }
  }

  // the only way a plain webpage can hand a photo to the real system
  // Gallery/Photos app without native code: the Web Share API opens
  // Android's share sheet, where "Save image" / "Save to Photos" appears
  // as one of the targets. Returns true if a share sheet was shown.
  async function saveToDeviceGallery(dataURL, filename) {
    try {
      const response = await fetch(dataURL);
      const blob = await response.blob();

      const file = new File([blob], filename, { type: "image/jpeg" });

      // Android / supported browsers
      if (
        navigator.share &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "MochiCam Photo",
        });

        return true;
      }
    } catch (err) {
      // User closing the share sheet isn't really an error
      if (err?.name === "AbortError") {
        return false;
      }

      console.error("Gallery share failed:", err);
    }

    return false;
  }

  lbDownload.addEventListener("click", async () => {
    const p = photos.find((x) => x.id === currentLightboxId);
    if (!p) return;
    const filename = "mochicam-" + p.id + ".jpg";

    const shared = await saveToDeviceGallery(p.dataURL, filename);
    if (shared) return;

    try {
      const res = await fetch(p.dataURL);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      showToast("check your downloads!");
    } catch (err) {
      console.error("download failed", err);
      // last resort: open it in a new tab so it can be long-pressed and saved
      window.open(p.dataURL, "_blank");
      showToast("long-press the photo to save it");
    }
  });
  lbDelete.addEventListener("click", async () => {
    const id = currentLightboxId;
    if (!id) return;
    photos = photos.filter((x) => x.id !== id);
    renderFilmstrip();
    closeLightbox();
    try {
      await storeDelete("photo:" + id, false);
    } catch (err) {
      /* ignore */
    }
  });
  galleryPeekBtn.addEventListener("click", () => {
    if (photos.length) openLightbox(photos[0].id);
  });

  async function savePhoto(dataURL) {
    const id = Date.now().toString();
    photos.unshift({ id, dataURL });
    if (photos.length > 30) {
      const removed = photos.pop();
      try {
        await storeDelete("photo:" + removed.id, false);
      } catch (err) {
        /* ignore */
      }
    }
    renderFilmstrip();
    const result = await storeSet(
      "photo:" + id,
      JSON.stringify({ dataURL, ts: id }),
      false,
    );
    if (!result && storageBroken) {
      showToast("saved for this session only — can't persist here");
    }
  }

  async function loadGallery() {
    try {
      const listRes = await storeList("photo:", false);
      if (!listRes || !listRes.keys || listRes.keys.length === 0) return;
      const loaded = [];
      for (const key of listRes.keys) {
        try {
          const res = await storeGet(key, false);
          if (res && res.value) {
            const parsed = JSON.parse(res.value);
            loaded.push({
              id: key.replace("photo:", ""),
              dataURL: parsed.dataURL,
              ts: parsed.ts,
            });
          }
        } catch (e) {
          /* skip missing */
        }
      }
      loaded.sort((a, b) => Number(b.ts) - Number(a.ts));
      photos = loaded.map((p) => ({ id: p.id, dataURL: p.dataURL }));
      renderFilmstrip();
    } catch (err) {
      console.error("gallery load failed", err);
    }
  }
  requestPersistentStorage();
  loadGallery();
})();
