export function initAfinador(container, config) {
  const { sessionId, filename, apiBase, jwt, onConfirm, onClose } = config;

  const $ = (id) => container.querySelector(`#${id}`) || document.getElementById(id);

  const API_URL_PATH = '/upload/afinar';
  function apiUrl(path) {
    return `${apiBase}${API_URL_PATH}${path}`;
  }

  function authHeaders() {
    return jwt
      ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }
      : { 'Content-Type': 'application/json' };
  }

  $('af-header-filename').textContent = filename;

  let schema = null;
  let params = {};
  let analisisData = null;

  function setStatus(msg, tipo = 'busy') {
    const el = $('status');
    el.hidden = false;
    el.className = 'status ' + tipo;
    el.textContent = msg;
  }

  function renderControles() {
    const cont = $('controles');
    cont.innerHTML = '';
    const grupos = {};
    for (const p of schema.parametros) {
      const g = p.grupo || 'general';
      if (!grupos[g]) grupos[g] = [];
      grupos[g].push(p);
    }
    const titulos = { general: 'General', router: 'Router auto', opencv: 'OpenCV', pequeña: 'Imagen pequeña', rembg: 'rembg' };
    for (const [g, items] of Object.entries(grupos)) {
      const wrap = document.createElement('div');
      wrap.className = 'grupo';
      wrap.innerHTML = `<div class="grupo-title">${titulos[g] || g}</div>`;
      for (const p of items) {
        const id = p.id;
        if (p.tipo === 'select') {
          const opts = (p.opciones || schema.metodos.map((m) => m.id))
            .map((o) => `<option value="${o}">${o || '(automático)'}</option>`)
            .join('');
          wrap.innerHTML += `<label for="p-${id}">${p.label}</label><select id="p-${id}">${opts}</select>`;
        } else if (p.tipo === 'range') {
          const v = p.default ?? 0;
          params[id] = v;
          wrap.innerHTML += `<label for="p-${id}">${p.label}<span class="range-val" id="v-${id}">${v}</span></label>
            <input type="range" id="p-${id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" />`;
        } else if (p.tipo === 'tristate') {
          const def = p.default || 'auto';
          wrap.innerHTML += `<label for="p-${id}">${p.label}</label>
            <select id="p-${id}">${p.opciones.map((o) => `<option value="${o}"${o===def?' selected':''}>${o}</option>`).join('')}</select>`;
        } else if (p.tipo === 'bool') {
          wrap.innerHTML += `<label><input type="checkbox" id="p-${id}" ${p.default ? 'checked' : ''} /> ${p.label}</label>`;
        }
      }
      cont.appendChild(wrap);
    }
    cont.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('change', leerParams);
      if (el.type === 'range') {
        el.addEventListener('input', () => {
          const ve = $(`v-${el.id.slice(2)}`);
          if (ve) ve.textContent = el.value;
          leerParams();
        });
      }
    });
    leerParams();
  }

  function leerParams() {
    for (const p of schema.parametros) {
      const el = $(`p-${p.id}`);
      if (!el) continue;
      if (p.tipo === 'bool') params[p.id] = el.checked;
      else if (p.tipo === 'range') params[p.id] = Number(el.value);
      else params[p.id] = el.value;
    }
  }

  function aplicarParams(vals) {
    for (const [k, v] of Object.entries(vals)) {
      const el = $(`p-${k}`);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
      if (el.type === 'range') {
        const ve = $(`v-${k}`);
        if (ve) ve.textContent = v;
      }
    }
    leerParams();
  }

  async function aplicarRecorte() {
    leerParams();
    setStatus('Procesando…', 'busy');
    const t0 = performance.now();
    try {
      const res = await fetch(apiUrl('/recortar'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ session_id: sessionId, filename, params }),
      }).then((r) => r.json());
      const ms = Math.round(performance.now() - t0);
      if (res.ok && res.preview_b64) {
        $('prev-out').innerHTML = `<img src="data:image/jpeg;base64,${res.preview_b64}" alt="recorte" />`;
        $('meta-out').textContent = `${res.metodo} \u00b7 ${res.size} \u00b7 \u00e1rea ${res.area_ratio != null ? (res.area_ratio * 100).toFixed(1) : '\u2014'}% \u00b7 ${res.ms} ms \u00b7 ${res.detalle}`;
        setStatus(`Listo en ${ms} ms`, 'ok');
      } else {
        $('prev-out').innerHTML = '<span class="placeholder">Error en recorte</span>';
        $('meta-out').textContent = res.detalle || 'Error';
        setStatus(res.detalle || 'Falló', 'err');
      }
    } catch (err) {
      setStatus(err.message, 'err');
    }
  }

  async function confirmar() {
    leerParams();
    setStatus('Guardando…', 'busy');
    try {
      const res = await fetch(apiUrl('/aplicar'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ session_id: sessionId, filename, params }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Error al guardar');
      }
      const data = await res.json();
      setStatus('Recorte guardado en sesión', 'ok');
      if (onConfirm) onConfirm({ ok: true, filename, preview_b64: data.preview_b64 });
    } catch (err) {
      setStatus(err.message, 'err');
    }
  }

  async function iniciar() {
    setStatus('Cargando análisis…', 'busy');
    try {
      const res = await fetch(apiUrl('/iniciar'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ session_id: sessionId, filename }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Error al iniciar');
      }
      const data = await res.json();
      analisisData = data.analisis;

      $('prev-orig').innerHTML = `<img src="data:image/jpeg;base64,${data.original_b64}" alt="original" />`;

      if (data.crop_actual_b64) {
        $('prev-out').innerHTML = `<img src="data:image/jpeg;base64,${data.crop_actual_b64}" alt="recorte actual" />`;
        $('meta-out').textContent = 'Recorte automático actual';
      }

      const a = data.analisis;
      $('panel-analisis').hidden = false;
      $('analisis-dl').innerHTML = `
        <div class="row"><dt>Escena</dt><dd>${a.escena}</dd></div>
        <div class="row"><dt>Forma</dt><dd>${a.forma} (c=${a.circularidad})</dd></div>
        <div class="row"><dt>Ruta auto</dt><dd><strong>${a.ruta}</strong></dd></div>
        <div class="row"><dt>Tamaño</dt><dd>${a.size}</dd></div>`;
      $('analisis-razon').textContent = a.razon;

      schema = data.schema;
      renderControles();

      aplicarParams({
        metodo: 'auto',
        forzar_ruta: a.params_sugeridos.forzar_ruta || '',
        ...a.params_sugeridos,
      });

      $('status').hidden = true;
      await aplicarRecorte();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  }

  $('btn-aplicar').addEventListener('click', aplicarRecorte);
  $('btn-reset').addEventListener('click', () => {
    if (!$('panel-analisis').hidden && analisisData) {
      const ruta = analisisData.ruta || '';
      aplicarParams({ metodo: 'auto', forzar_ruta: ruta === 'pequeña' ? '' : ruta });
      aplicarRecorte();
    }
  });
  $('btn-guardar').addEventListener('click', confirmar);
  $('btn-cerrar').addEventListener('click', () => { if (onClose) onClose(); });

  iniciar();
}
