# Reimagined Launcher

Un launcher de Minecraft de **código abierto** con el Reimagined Client integrado (FPS Boost nativo).
Mantiene la esencia vanilla del juego mientras mejora el rendimiento — todo con una identidad visual propia.

| | |
|---|---|
| **Versión actual** | v1.0.3 |
| **Plataforma** | Windows x64 (instalador NSIS) |
| **Idiomas** | Español / English |
| **Licencia** | Código abierto (ver repositorio) |

---

## ✨ Características

- 🎮 **Lanzamiento de Minecraft** — perfiles Vanilla / Fabric / Forge, versión y RAM configurables
- 🚀 **Reimagined Client** — capa nativa de optimización (FPS Boost): threading de chunks, partículas reducidas, nubes simplificadas, render distance inteligente
- 📦 **Mods y Modpacks** — navegador integrado de **Modrinth** (búsqueda, categorías, versión, instalación en 1 clic)
- 👕 **Skins** — vista previa 3D del jugador, subir/aplicar skin de tu cuenta
- ⬇️ **Gestor de descargas** — progreso real, velocidad y estado en vivo
- 🔄 **Actualizaciones automáticas** — detecta nuevas versiones del repo y se actualiza solo
- 🛡️ **Seguridad** — login de Microsoft oficial (device-code), tokens cifrados con DPAPI de Windows, sin telemetría

## 📥 Instalar

1. Descarga el instalador desde la carpeta `dist/` del repo:
   `https://raw.githubusercontent.com/friendlyssmp-blip/Reimagined_Launcher/main/dist/Reimagined-Setup-1.0.3.exe`
2. **Verifica el checksum** (más abajo) antes de ejecutarlo.
3. Ejecuta el instalador. Si Windows muestra "editor desconocido": **Más información → Ejecutar de todos modos** (es normal: el instalador no está firmado digitalmente).

📖 **Guía completa paso a paso (en español):** → [`TUTORIAL.md`](TUTORIAL.md)

### 🔐 Checksum oficial (SHA-256)

```
43e2e26dae919d7d664514a4d4f1925e3d5cd90c2f0df404753a4be70decfff7  Reimagined-Setup-1.0.3.exe
```

Verifica tu descarga en PowerShell:

```powershell
Get-FileHash .\Reimagined-Setup-1.0.3.exe -Algorithm SHA256
```

Si el hash **no coincide**, el archivo fue modificado — **no lo ejecutes** y descarga de nuevo.

## 🛡️ Seguridad

- El launcher **nunca** maneja tu contraseña de Microsoft (flujo device-code oficial en `microsoft.com/link`).
- Los tokens de sesión se guardan **cifrados** en tu usuario (`AppData\Roaming\Reimagined`), no en el repo.
- No hay telemetría ni envío de datos a terceros — solo los servidores oficiales de Microsoft/Minecraft.
- El código es abierto: cualquiera puede auditar exactamente qué hace.

Ver [`SECURITY.md`](SECURITY.md) y [`PUBLISHING.md`](PUBLISHING.md).

## 🛠️ Desarrollo

```bash
npm install       # dependencias
npm run typecheck # tsc (node + web)
npm run build     # electron-vite build
npm run dev       # modo desarrollo
npm run package   # genera el instalador en dist/
npm run bench     # benchmark de rendimiento del Reimagined Client
```

## 📦 Publicar una nueva versión

1. Sube el número en `package.json` **y** en `update/latest.json`.
2. `npm run build` y `npm run package`.
3. `git add -A && git commit && git push` (el instalador en `dist/` se sube solo).

Los launchers instalados detectarán la update automáticamente y se actualizarán con un clic.

## 📄 Documentación

- [`TUTORIAL.md`](TUTORIAL.md) — guía de descarga e instalación segura
- [`PUBLISHING.md`](PUBLISHING.md) — cómo publicar el proyecto sin filtrar datos
- [`CHANGELOG.md`](CHANGELOG.md) — historial de versiones
