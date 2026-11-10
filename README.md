# Mathletics Desktop 1.0.5

Launcher de escritorio no oficial para la experiencia web oficial de Mathletics.

## Inicio

1. Instala Node.js LTS.
2. Abre CMD en esta carpeta.
3. Ejecuta `npm install`.
4. Ejecuta `npm start`.
5. En el primer inicio puedes guardar tus credenciales en la ventana local o elegir **Ahora no**.
6. Entra al portal oficial y abre Games → Multiverse.

## Guardado seguro de credenciales

- La contraseña y el nombre de usuario se cifran con `safeStorage` de Electron. En Windows, Electron utiliza la protección criptográfica del usuario de Windows (DPAPI).
- El archivo cifrado se almacena en `%APPDATA%\Mathletics Desktop\credentials.enc.json`.
- Las credenciales solo se descifran cuando la página principal está en `https://login.mathletics.com/`.
- La aplicación rellena los campos visibles de usuario y contraseña, pero **no envía el formulario**. El usuario confirma el inicio de sesión.
- El menú **Cuenta** permite guardar/actualizar o eliminar las credenciales.
- Cada cuenta de Windows mantiene su propio almacén. No compartas la carpeta `%APPDATA%\Mathletics Desktop` ni perfiles de sesión.
- La protección DPAPI está vinculada a la cuenta de Windows de ese equipo; copiar el archivo cifrado a otro usuario/PC no es un mecanismo para compartir credenciales.

La persistencia de cookies y la contraseña guardada son mecanismos separados. Mathletics puede invalidar sesiones desde sus servidores. Si el portal cambia de dominio o de estructura de formulario, el autocompletado puede dejar de funcionar y habrá que actualizar la lista de dominios o los selectores. La aplicación no intenta saltarse CAPTCHA, MFA ni controles del servicio.

## Build para Windows

```bat
npm install
npm run dist
```

Los paquetes se generan en `dist/` (instalador NSIS y EXE portable).

## Icono

Coloca tu icono de Windows en `assets/icon.ico` antes de compilar. Si no tienes un icono, puedes crear la carpeta `assets` y añadirlo más adelante; el icono de la ventana será opcional durante el desarrollo.

## Notas

- Requiere cuenta Mathletics e Internet.
- No es una aplicación oficial de 3P Learning.
- No incluyas credenciales ni archivos del perfil de usuario al distribuir el EXE.
