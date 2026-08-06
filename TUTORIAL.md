# Reimagined Launcher - Guia de Descarga e Instalacion Segura

> Idioma: Espanol - Duracion: ~3 minutos
> Version del instalador: v1.0.3

---

## 1. Descargar el instalador

Descarga **solo desde el repositorio oficial**:

```
https://github.com/friendlyssmp-blip/Reimagined_Launcher
```

El instalador real esta en la carpeta **`dist/`** del repo:

- **Link directo:**
  `https://raw.githubusercontent.com/friendlyssmp-blip/Reimagined_Launcher/main/dist/Reimagined-Setup-1.0.3.exe`
- **O en GitHub:** abre el repo - carpeta `dist` - `Reimagined-Setup-1.0.1.exe` - boton Download.

> Regla de oro: si alguien te pasa el .exe por Discord/WhatsApp/enlace raro, **verifica el checksum** (paso 2) antes de ejecutarlo. Solo confia en el hash publicado en el repositorio.

---

## 2. Verificar que el archivo es autentico (checksum SHA-256)

Esto garantiza que el archivo es **exactamente** el publicado y que nadie lo ha modificado.

**En PowerShell** (Win + R - escribe `powershell` - Enter):

```powershell
Get-FileHash "C:\Users\TU_USUARIO\Downloads\Reimagined-Setup-1.0.3.exe" -Algorithm SHA256
```

Debe devolver **exactamente**:

```
43e2e26dae919d7d664514a4d4f1925e3d5cd90c2f0df404753a4be70decfff7
```

- Si **coincide** - el archivo es autentico, puedes instalarlo tranquilo.
- Si **NO coincide** - el archivo fue modificado o la descarga se corrompio. **NO lo ejecutes.** Borralo y descarga de nuevo.

---

## 3. El aviso de "Aplicacion desconocida" de Windows (SmartScreen)

Al ejecutar el instalador, Windows mostrara:

> "Windows protegio su equipo" / "Esta aplicacion es de un editor desconocido"

**¿Es seguro?** Si. Este aviso **NO** significa que el archivo sea peligroso - significa que el instalador **no esta firmado digitalmente** (no tenemos certificado de firma de pago). Cualquier launcher gratuito sin firmar pasa por esto.

**Como instalarlo igualmente** (3 clics):

1. Haz clic en **"Mas informacion"** / "More info"
2. Haz clic en **"Ejecutar de todos modos"** / "Run anyway"
3. Confirma el instalador y listo.

> Extra de seguridad: tras verificar el checksum (paso 2) ya sabes que el archivo es exactamente el oficial.

---

## 4. Instalar

1. Doble clic en `Reimagined-Setup-1.0.3.exe`
2. Elige la carpeta de instalacion (deja la que propone)
3. **Instalar** - espera a que termine (~1 minuto)
4. Abre el acceso directo del Escritorio / Menu Inicio

> **Donde guarda tus datos:** el launcher guarda perfiles, cuentas y mods en `C:\Users\TU_USUARIO\AppData\Roaming\Reimagined\` - **no** en la carpeta de instalacion. Desinstalar o actualizar el launcher **no borra** tus perfiles ni mods.

---

## 5. Primer uso

1. **Inicia sesion** con tu cuenta de Microsoft. Tus datos de sesion se guardan **cifrados** en tu PC - nunca se envian a ningun sitio excepto a los servidores oficiales de Microsoft/Minecraft.
2. **Crea tu primer perfil** (version de Minecraft + loader: Vanilla / Fabric / Forge).
3. Pulsa **Play** y a jugar.

> El launcher incluye el **Reimagined Client con FPS Boost** integrado de fabrica.

---

## 6. Actualizaciones

- Al arrancar, el launcher **comprueba automaticamente** si hay una version nueva en el repo.
- Si hay update, veras una notificacion **"Update disponible"** en el sidebar.
- Clic - **Download & Install** - el launcher se actualiza solo (tus datos se conservan).

---

## 7. Preguntas frecuentes

| Problema | Solucion |
|---|---|
| "Windows protegio su equipo" | Paso 3: Mas informacion - Ejecutar de todos modos |
| No encuentro el instalador | Solo en `dist/` del repo oficial, nunca en otros sitios |
| "El hash no coincide" | Descarga corrupta o archivo falso - borra y descarga del repo |
| El juego no arranca | Revisa la seccion **Logs** del launcher y mira el error |
| Quiero reportar un bug | Copia el log desde **Logs - Copiar** y abre un Issue en el repo |

---

## 8. Para desarrolladores

- **Auditar el codigo:** el codigo fuente completo esta en el repositorio oficial.
- **Compilar tu propio instalador:** `npm install` - `npm run build` - `npm run package` (sale en `dist/`).
- **Publicar:** sigue [`PUBLISHING.md`](PUBLISHING.md).

---

*Reimagined Launcher - codigo abierto. Cualquiera puede auditar que hace exactamente.*
