# NOVA OPTIMIZER

Optimizador de assets de FiveM (addon props y clothing) que corre en tu servidor con Node.js y MySQL.

Sube un `.xml`, `.meta`, `.ytyp.xml` o `.ymt.xml` y descarga la versión optimizada. El historial de optimizaciones se guarda en tu MySQL remoto.

## Funcionalidades

- Interfaz futurista drag & drop
- Optimización segura de XML/META:
  - Elimina comentarios
  - Elimina nodos vacíos (sin atributos ni contenido)
  - Recorta decimales numéricos (precisión 6)
  - Compacta espacios y líneas en blanco
- Conserva elementos con atributos (p.ej. `<bbMin x=".." y=".." z=".."/>`)
- Comparativa antes/después con porcentaje de ahorro
- Historial persistido en MySQL (hosting)

## Estructura

```
fivem-prop-creator/
├── server.js            # Servidor Express (API + estáticos)
├── package.json
├── database.sql         # Esquema MySQL para tu hosting
├── .env.example         # Plantilla de configuración
├── server/
│   ├── optimizer.js     # Motor de optimización XML
│   └── db.js            # Conexión MySQL
├── public/
│   ├── index.html       # Frontend futurista
│   ├── css/style.css
│   └── js/nova.js
└── test/                # Archivos de prueba
```

## Instalación y arranque (local / servidor)

```bash
npm install
cp .env.example .env   # completa tus datos MySQL
node server.js
```

Abrir `http://localhost:3000`.

## Configuración MySQL (tu hosting)

1. Ejecuta `database.sql` en tu MySQL (phpMyAdmin o consola) para crear la tabla `optimizations`.
2. En `.env` pon los datos de tu base remota:

```
DB_HOST=tuhosting.com
DB_PORT=3306
DB_USER=tu_usuario
DB_PASSWORD=tu_password
DB_NAME=tu_base_de_datos
```

3. Reinicia el servidor. El indicador "MySQL" del header pasará a verde.

Sin MySQL configurado la app sigue funcionando, solo sin historial.

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/health`  | Estado del servidor y conexión MySQL |
| GET  | `/api/history?limit=20` | Historial de optimizaciones |
| POST | `/api/optimize` | Multipart `file` → XML optimizado + stats |
