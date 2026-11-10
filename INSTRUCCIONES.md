# Escapa de los Profesores + Supabase (acceso por nickname)

## 1. Ejecutar las consultas SQL
1. Abre tu proyecto de Supabase.
2. Entra en **SQL Editor > New query**.
3. Abre `supabase-schema.sql`, copia todo el contenido y pégalo en el editor.
4. Pulsa **Run**. Esto crea `player_profiles`, `player_progress`, sus políticas RLS y el trigger que registra nicknames únicos.

## 2. Configurar el inicio de sesión
1. En Supabase entra en **Authentication > Providers > Email**.
2. Desactiva **Confirm email** (confirmación de correo), porque el jugador no introduce ni recibe un correo. La app crea un identificador interno técnico a partir del nickname para usar Supabase Auth.
3. No cambies la URL ni la Publishable Key que ya están configuradas en `js/supabase.js`.

## 3. Publicar
Sube a GitHub manteniendo esta estructura:
- `index.html`
- `css/style.css`
- `js/data.js`
- `js/game.js`
- `js/music.js`
- `js/supabase.js`

`supabase-schema.sql` e `INSTRUCCIONES.md` son para ti; no son necesarios para que GitHub Pages ejecute el juego.

## 4. Cómo funciona
- El jugador escribe nickname y contraseña; no ve ni necesita correo.
- Nicknames de 3–20 caracteres: letras, números y guion bajo.
- Contraseña mínima: 8 caracteres.
- El progreso se sincroniza con `player_progress`.

## Seguridad
La Publishable key puede estar en el navegador; nunca pongas una Secret key ni `service_role` en HTML/JavaScript. RLS limita el acceso a la fila de progreso del propio usuario. Esta versión guarda progreso enviado por el cliente, por lo que no debe usarse aún para un ranking competitivo con premios: los puntos podrían manipularse desde el navegador.

## Importante
El paquete original no incluía el archivo de música `js/music.js`; se conserva el archivo provisional de compatibilidad incluido en el ZIP. La música no sonará hasta restaurar el archivo original.


IMPORTANTE PARA EL ACCESO CON NICKNAME: en Supabase, Authentication > Sign In / Providers, el proveedor Email debe permanecer ACTIVADO. Desactiva solamente Confirm email. La app genera internamente una dirección técnica con el dominio players.escapaprofesores.com; los jugadores nunca la ven ni reciben correos. No desactives por completo el proveedor Email.
