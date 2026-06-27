# Frontend — Galería de Etiquetas

Frontend vanilla HTML/JS con Tailwind CSS CDN. Sin build step, sin node_modules.

## Requisitos

- Docker (para despliegue con nginx)
- Acceso al backend en `http://<IP_DEL_BACKEND>:10000`

## Despliegue rápido con Docker

### 1. Copiar la carpeta `frontend/`

```bash
scp -r frontend/ usuario@equipo-destino:/ruta/
```

### 2. Configurar la IP del backend

Editar `js/config.js`:

```js
// Detección automática por hostname
if (window.location.hostname === 'LOCAL_SERVER_NAME') {
  window.API_URL = '/backend-etiquetas/api';
} else {
  window.API_URL = '/api';  // nginx proxy (mismo equipo)
}
```

Para acceso directo desde otro equipo, cambiar la opción `else`:

```js
} else {
  window.API_URL = 'http://192.168.1.100:10000/api';
}
```

### 3. Construir y ejecutar

```bash
# Con proxy nginx (config.js = '/api')
docker build \
  --build-arg BACKEND_HOST=192.168.1.100 \
  --build-arg BACKEND_PORT=10000 \
  -t frontend-etiquetas .

docker run -d -p 3300:80 --name frontend-etiquetas frontend-etiquetas

# Sin proxy, acceso directo (config.js = 'http://...')
docker run -d -p 3300:80 --name frontend-etiquetas frontend-etiquetas
```

El frontend estará disponible en `http://localhost:3300`.

## Despliegue sin Docker

Cualquier servidor HTTP estático sirve los archivos:

```bash
# Python
cd frontend/
python -m http.server 3300

# Node (npx)
npx serve frontend/ -l 3300

# nginx manual
cp frontend/* /usr/share/nginx/html/
```

En este caso `config.js` **debe** usar la URL completa del backend:

```js
window.API_URL = 'http://192.168.1.100:10000/api';
```

## Estructura

```
frontend/
├── index.html          # Entry point
├── js/
│   ├── config.js       # URL del backend (EDITAR)
│   ├── app.js          # Router + init
│   ├── api.js          # Fetch wrapper + SSE
│   ├── gallery.js      # Grid + búsqueda + visor
│   ├── upload.js       # Upload 3 fases (crop → OCR → describe)
│   ├── admin.js        # CRUD usuarios + rotar/borrar
│   └── login.js        # Formulario login
├── css/
│   └── style.css       # Estilos mínimos
├── nginx.conf          # Config nginx (solo para Docker)
└── Dockerfile          # nginx:alpine
```

## Variables de entorno (Docker)

| Variable | Default | Descripción |
|---|---|---|
| `BACKEND_HOST` | `app` | Hostname/IP del backend |
| `BACKEND_PORT` | `8000` | Puerto del backend |

## CORS

El backend debe permitir el origen del frontend. Si accedes desde `http://otro-equipo:3300`, añade esa IP a `allow_origins` en `api_server.py`:

```python
allow_origins=[
    "http://localhost:3300",
    "http://192.168.1.50:3300",  # <-- añadir
]
```

## Credenciales por defecto

- **Email**: `admin@example.com`
- **Contraseña**: `admin123`
