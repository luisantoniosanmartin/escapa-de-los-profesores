# ESCAPA DE LOS PROFESORES

Juego web (HTML + Canvas, sin dependencias) ambientado en el **Colegio San Patricio**.
10 jugadores por partida: **tú + 9 IA**. Al empezar, un sorteo decide tu rol:
**50 % estudiante** y **50 % profesor**.

- **Duración:** 8:00
- **Empieza de día** y cada **2:00** cambia el ciclo: día → noche → día → noche.
  La primera noche cae a las **6:00** y los profesores ven menos, pero la caza sigue
- **7 estudiantes** contra **3 profesores**
- **No hay salida**: si al llegar al 8:00 queda algún estudiante en pie, **ganan los estudiantes**

---

## Cómo se juega

| Rol | Objetivo |
|---|---|
| **Estudiante** | No hay salida: **sobrevive hasta el 8:00**. Si queda alguien en pie, ganan los estudiantes |
| **Profesor** | Deja a los 7 estudiantes sin vida antes de que acabe el tiempo |

Antes de empezar, **tú y las IA eligen personaje** (el sorteo de rol ocurre primero).

La partida abre con una **presentación animada de los tres profesores** (Rojas, Cáceres y Quispe), con sus trajes, frases y especialidades. Puedes saltarla con **ESPACIO**, **ENTER**, **ESC** o un clic; el reloj de los 8:00 empieza después.

### Controles

- **WASD** o **flechas**: moverte
- **ESPACIO**: habilidad del estudiante / Agendazo del profesor
- **Q**: segunda habilidad de Morante y Luis
- **1 2 3**: las 3 habilidades del profesor
- **E**: abrir la misión del aula
- **1–4**: responder la pregunta; **ENTER/ESPACIO**: confirmar
- **M**: activar o silenciar la música de persecución
- **ESC**: pausa / salir de la misión

---

## Estudiantes (4º)

| Personaje | Habilidad | Efecto |
|---|---|---|
| **Leonardo** | Ralentizar (12 s) | Aura de 6 s: los profesores cercanos van al **50 % de velocidad** |
| **Jonny** | Baile (10 s) | Baila 5 s y sube un **75 %** su velocidad |
| **Morante** | Invisibilidad (15 s) | **Solo de noche**: 5 s invisible, los profesores no lo ven |
| **Morante** | Robar habilidad (Q, 16 s) | Le roba una habilidad al azar a otro estudiante y la usa **al instante** |
| **Luis** | Reglazo (8 s) | Golpea con la regla: **20 de daño** y el profesor queda **2 s sin moverse**. Luis corre un **45 % más rápido durante 4 s**. Mientras recarga, bloquea y recibe 40 % menos daño |
| **Luis** | ¿Por cuál página? (Q, 12 s) | Grita «¿Por cuál página vas?» y lanza una onda: los profesores alcanzados **retroceden 1,2 s** y son empujados hacia atrás |
| **Ipa** | Comer (12 s) | Regenera **35 de vida** |
| **Elías** | Zapatos al revés (14 s) | Se pone los zapatos mal: **5 s al 50 % de velocidad**, pero es **INMUNE a todos los ataques** (burbuja turquesa) |

## Profesores

### Profe Rojas (el de la agenda)

1. **Agendazo** — golpe con la agenda: **23 de daño**. Recarga **2 s**.
2. **Decomiso** — quita la agenda a un estudiante al azar: su **próximo Agendazo hace el DOBLE (46 de daño)**.
3. **Examen sorpresa** — invoca un examen que **persigue al estudiante más cercano**. Si lo alcanza: **10 de daño** y **revela su ubicación** (queda marcado en rojo y visible en el minimapa).

### Profe Cáceres (el del grito)

1. **¡Siéntate!** — grito a distancia: lanza una onda sonora que hace **40 de daño** al primer estudiante que alcance. Recarga **7 s**.
2. **No me hagas perder el tiempo** — se intercambia con el profesor mejor colocado y deja un **aura negra durante 8 s**: quien entre se mueve un **75 % más lento**. Recarga **16 s**.
3. **No puedes vencerme** — se vuelve **invisible para los estudiantes durante 6 s** (los profesores sí lo ven). Recarga **20 s**.

> Cáceres es el único profesor que **puede seguir caminando mientras habla**. Sus frases no lo
> clavan al suelo: grita, se intercambia o desaparece sin dejar de perseguir a los alumnos.

### Profe Quispe (el del peine regla)

1. **Peine regla** — golpea con su peine regla de metal: **30 de daño** al estudiante
   más cercano que tenga delante. Recarga **2,4 s**.
2. **Invocar profes** — invoca durante **9 s** al **Profe Primero** y al **Profe Tercero**.
   El Primero persigue al estudiante **más cercano**; el Tercero, al **tercero más cercano**.
   Los invocados dan 8 de daño y pueden ser noqueados: **no cuentan** para los 3 profesores
   principales ni para la victoria. Si ya están los dos, la invocación los **refuerza**
   (recuperan vida y duración). Recarga **18 s**.
3. **Castigo de recreo** — dice «El tiempo que me estás haciendo perder lo voy a tomar en el
   recreo», se queda quieto mientras habla y después **embiste hacia delante**: **60 de daño**
   a todo lo que pille en su camino. Si golpea a un estudiante, se detiene y se **peina 1 s**
   con el peine regla. Recarga **16 s**.

> **Los invocados copian sus habilidades.** Cuando Quispe usa el Peine regla, Primero y
> Tercero lanzan también su peinazo de 30. Cuando usa el Castigo de recreo, los dos avisan y
> embisten con él. La invocación repetida los refuerza en lugar de crear copias infinitas.
>
> Las invocaciones son **temporales**: aparecen con un efecto espectral, persiguen su objetivo,
> tienen ataque cuerpo a cuerpo y se desvanecen al agotar su tiempo o al ser noqueadas.

---

## Música de persecución

Cada profesor tiene su propio tema, generado en tiempo real con **Web Audio** (sin archivos
de audio externos). La música entra cuando ese profesor te está persiguiendo y sube de
intensidad a medida que se acerca:

- **Rojas**: marcha urgente con percusión seca, bajo staccato y el tic-tac de la agenda.
- **Cáceres**: sirena grave, palmas y un pad oscuro que acompaña al grito.
- **Quispe**: ritmo rápido, ticks metálicos y arpegio de peine regla.

Si hay varios profesores detrás de ti, suena el tema del más cercano y se hace un
**crossfade** al cambiar de perseguidor. Si juegas como profesor, suena tu propio tema
mientras persigues a un alumno. La música se detiene al pausar, al terminar la partida o
cuando nadie te persigue. Pulsa **M** o usa el botón **MÚSICA** de la pausa para
silenciarla; la preferencia se guarda en `localStorage`
(`escapaProfesores.audio.v1`).

---

## Misiones de clase

Hay **14 misiones** repartidas por el colegio: **8 de preguntas** y **6 tareas de limpieza**.

**Misiones de preguntas (5 preguntas con 4 opciones):**

- **Misiones de tiempo:** **4A Matemáticas**, **4B Ciencias**, **4C Lengua** y
  **4D Historia**. Cada acierto **resta 20 segundos** al reloj.
- **Misiones de refuerzo:** **Sala de Informática**, **Laboratorio**, **Biblioteca** y
  **Aula de Música**. Cada acierto da puntos de examen y **no toca el reloj**.

**Tareas de limpieza:**

- **Limpieza del aula** (4A), **Gimnasio limpio**, **Cafetería limpia**,
  **Taller ordenado**, **Laboratorio limpio** y **Biblioteca ordenada**. Al empezar
  aparecen **5 objetos** por la sala; recógelos caminando por encima antes de que
  se acaben los **50 segundos**.
- Se pagan al completar: **+2 por objeto**, **+10 por terminar** y **+10 extra** si
  terminas en **25 segundos o menos**. No tocan el reloj de la partida.
- Si se acaba el tiempo o cancelas en la terminal, no se pierden puntos ya ganados
  (las tareas solo pagan al completarse) y puedes volver a intentarlo.
- Las tareas son para estudiantes. Si juegas como profesor, las IA también pueden
  limpiar: recorren los objetos y completan la tarea si no las interrumpes.
- Las misiones de preguntas solo se pueden intentar **una vez por partida**.
- Mientras respondes o limpias, **el mundo sigue funcionando**: los profesores te
  pueden pillar. **ESC** o el botón **SALIR** cierran una misión de preguntas.
- Si juegas como profesor, las IA resuelven las misiones de preguntas y las tareas
  por su cuenta. Si eliminas al alumno que está resolviendo una, ganas
  **+10 puntos** por **Misión defendida**.
- Los atriles se marcan en el mapa y en el minimapa; los de refuerzo llevan la
  etiqueta **REFUERZO** y las tareas la etiqueta **TAREA**. El panel de misiones
  muestra las 14 en cuatro filas, y durante una tarea aparece un panel con el
  progreso y el tiempo restante.

---

## Comida por el mapa

Cada partida reparte **14 objetos de comida** por las salas. Se recogen caminando
por encima y también los pueden usar las **IA estudiantes**:

| Comida | Efecto |
|---|---|
| **Inca Kola** | +35 % de velocidad durante 7 s |
| **Pan con jamón** | Cura 32 de vida |
| **Arroz con leche** | Cura 22 y +15 % de velocidad durante 5 s |
| **Chicha morada** | Cura 12 y +25 % de velocidad durante 6 s |
| **Empanada** | Cura 40 de vida |
| **Lúcuma** | Cura 15 y +20 % de velocidad durante 4 s |

La comida reaparece poco a poco mientras la partida sigue. No cambia el reloj ni
las misiones: es una ayuda táctica para escapar, aguantar una persecución o
recuperarte después de un golpe.

---

## Trajes y puntos de examen

El menú principal tiene un botón **TRAJES** con un armario para **alumnos** y
**profesores**. Cada personaje tiene **11 trajes**: el **Clásico** (gratis) y
diez especiales, de raridades **Especial**, **Élite**, **Legendario** y
**Mítico**. En total hay **99 trajes**. Los trajes son cosméticos: no cambian la
vida, la velocidad, el daño ni las recargas.

| Acción | Puntos |
|---|---:|
| Respuesta correcta en una misión | **+3** |
| Completar una misión | **+8** |
| Misión perfecta (5/5) | **+12** |
| Objeto recogido en una tarea (al completar) | **+2** |
| Completar una tarea de limpieza | **+10** |
| Tarea rápida (25 s o menos) | **+10** |
| Racha de 3 aciertos seguidos | **+5** |
| Primera misión del día | **+15** |
| Apunte de examen | **+4** |
| Apunte dorado | **+10** |
| Recoger todos los apuntes | **+15** |
| Noquear a un profesor | **+12** |
| Reprobar a un estudiante como profesor | **+8** |
| Misión defendida como profesor | **+10** |
| Ganar como estudiante | **+40** |
| Ganar como profesor | **+55** |
| Cada estudiante en pie al ganar | **+4** |
| Victoria impecable (sin bajas) | **+20** |
| Sin bajas docentes como profesor | **+15** |
| Resistencia (por minuto) | **+1** |
| Todas las misiones y tareas | **+40** |
| Primera partida del día | **+5** |
| Primera victoria del día | **+10** |

- Los puntos se guardan en **`localStorage`** (`escapaProfesores.progreso.v1`),
  junto con los trajes comprados y el traje equipado de cada personaje.
- Los trajes de alumno cuestan **80**, **160**, **260** y **420** puntos; los de
  profesor, **120**, **220**, **340** y **560**.
- Al equipar un traje cambian la ropa, el pelo, los accesorios y la aureola del
  personaje. También cambia el **diseño visual de sus habilidades**: cada traje
  tiene su propia forma de efecto (onda, neón, notas, humo, hielo, fuego, rayos,
  confeti, tajo, pétalos, burbujas, runas, cosmos, glitch, prismas, vórtices,
  fuegos fatuos, destellos, hojas, auroras, portales, lluvia estelar, nieve o
  corazones) y su propia paleta para los golpes y proyectiles.
- Los seis trajes nuevos de cada personaje añaden **animaciones de cuerpo**:
  mecerse, rebotar, flotar, brillar, pulsar y orbitar partículas alrededor del
  personaje. Se ven también en los retratos y en las IA que los equipan.
- Los trajes **Legendario** y **Mítico** añaden detalles de silueta como alas,
  bufandas, colas, antifaces, visores, cascos, penachos y coronas.
- La pantalla **TRAJES** muestra una barra de colección por personaje y tarjetas
  con brillo, borde y chip de color según la rareza del traje.
- Las IA también llevan trajes: en cada partida se reparten al azar del catálogo de su
  personaje (30 % Clásico, 38 % Especial, 20 % Élite, 9 % Legendario y 3 % Mítico),
  con su ropa, accesorios y efectos de habilidad. No consumen tus puntos; el traje
  que compras y equipas se aplica a tu personaje y queda guardado.
- La victoria y los supervivientes se pagan al terminar la partida; las misiones,
  apuntes, rachas y estudiantes reprobados se pagan al instante. El resultado muestra
  el desglose y el saldo actual.

---

## Cómo jugarlo

**Opción 1 (recomendada):** doble clic en **`JUGAR-WEB.bat`** (levanta el servidor y abre
el juego en el navegador). La dirección es:

```
http://localhost:8321/
```

**Opción 2:** doble clic en **`JUGAR.bat`** (abre el juego directamente, sin servidor).

**Opción 3 (servidor a mano):**

```powershell
powershell -ExecutionPolicy Bypass -File servidor.ps1 -Porta 8321
# luego abre http://localhost:8321
```

## Archivos

```
escapa-de-los-profesores/
├── index.html        pantallas (menú, trajes, elección de personaje, resultado, pausa)
├── css/style.css     estilos de la interfaz
├── js/data.js        personajes, trajes, estadísticas y mapa del colegio (96 x 66 tiles)
├── js/music.js       motor de música procedural y temas de persecución
├── js/game.js        bucle de juego, IA, habilidades, progreso, render y HUD
├── servidor.ps1      servidor web mínimo (socket TCP, sin permisos de admin)
├── JUGAR-WEB.bat     servidor + navegador (recomendado)
├── JUGAR.bat         abrir el juego sin servidor
└── README.md
```

## Detalles técnicos

- Mapa **XXL de 96 × 66 tiles** (4608 × 3168 px ≈ 14,6 millones de px²): 15 salas
  (Aula 4A–4D, Sala de Informática, Laboratorio, Biblioteca, Sala de Profesores, Gimnasio,
  Aula de Música, Cafetería, Taller de Tecnología, Almacén, Salón de Actos y Pabellón),
  pasillos con taquillas, fuentes, máquinas expendedoras, carteles, **galerías de dibujos**
  y **vitrinas de trofeos**, y un **patio enorme** con pista de atletismo completa, cancha,
  fuente, escudo del colegio, árboles, bancos, una **plaza central pavimentada con rosa de
  los vientos y farolas**, un **huerto escolar** con bancales de hortalizas, una **pérgola**
  con mesa y farolillos, y una **zona ajardinada** con setos, flores, bicis y contenedores.
  La decoración está repartida por carriles y con espacio libre para que los objetos no se
  amontonen. El 100 % de las zonas libres están conectadas.
- La orientación y el ambiente del mapa se refuerzan con **rótulos pintados en el suelo**
  («Aulas 4A-4D», «Patio central», «Zona deportiva»...), un paso de cebra, una plaza
  pavimentada, un foso y pasillo de salto, tacos de salida, salto de altura, vallas, gradas
  junto a la pista y una bandera ondulante. Los **murales de Cafetería, Taller, Almacén,
  Salón de Actos y Pabellón** dan identidad a la fachada del patio, y cada aula tiene un
  panel temático (números, tabla periódica, lectura, línea del tiempo y código). El
  laboratorio tiene campana extractora y banco de prácticas, la biblioteca un globo terráqueo
  y un carrito de libros, la sala de profesores una cafetera e impresora, el gimnasio
  espalderas y material deportivo, y el salón de actos focos de escenario. Las farolas del
  patio y los farolillos de la pérgola se encienden de noche y proyectan charcos de luz.
  Todo es decorativo: no altera colisiones, puertas ni rutas.
- Las **puertas de las salas son dobles y animadas**: se abren al acercarse un estudiante o
  un profesor, muestran el código de la sala en el umbral y se cierran suavemente cuando el
  personaje se aleja. La animación es solo visual: no cambia las colisiones ni la búsqueda de
  rutas. Los pasillos llevan **alfombras**, las paredes tienen **paneles y zócalos**, y las
  ventanas y lámparas proyectan **charcos de luz** para dar profundidad al mapa. Cada sala
  tiene además un **suelo decorativo propio** (tarima, moqueta, baldosa, hormigón, damero o
  panel acústico), una marca de código de sala y taquillas con números y rejillas.
- Cada sala tiene su **color de muro, zócalo interior y mobiliario propio**: pupitres con
  libro, mesas de laboratorio con probetas, mesas redondas de cafetería, estanterías con
  libros, mesas de PC con monitor, bancos de taller, mesas de reuniones, atriles de música,
  gradas, butacas de teatro, cajas de almacén, piano, sofás, vitrinas de trofeos, etc.
- Personajes dibujados en **vista 3/4** con contorno, rebote al caminar y anatomía completa:
  piernas con costuras, bolsillos y luz en las rodillas, punteras, cordones y suela en los
  zapatos, torso con sombra y costuras, cinturón con hebilla, brazos con contorno y puños,
  manos, cuello, orejas con sombra interior, mejillas, cejas, párpados, nariz, boca
  (sonrisa o gesto serio), sombra de mentón y **vista de espaldas** cuando suben. Los
  profesores llevan **americana con solapas, camisa blanca, corbata con pin, pañuelo de
  bolsillo, botones dorados, gemelos y tarjeta del colegio**; los alumnos llevan cuello
  redondo, costuras laterales, puños, bolsillo en la sudadera de Morante y detalles propios.
- **Siluetas distintas**: cada personaje tiene su complexión (delgado, atlético, corpulento,
  alto, ancho, redondo o pulcro), así que los hombros y el torso cambian de forma. La sombra
  del suelo tiene dos capas para que los personajes no parezcan flotar.
- Complementos por personaje: **mochila** con hebillas y chapa del colegio en los alumnos
  (auriculares, gorra, capucha con cordones, regla en el bolsillo, bocadillo, zapatos y
  calcetines desparejados) y **corbata + identificación** en los docentes (agenda, tiza,
  gafas, bigote, **megáfono de Cáceres** y **peine regla**). Luis y los profesores llevan
  **reloj**; Jonny, Ipa y Elías, detalles de color en las zapatillas. Las mangas de los
  profesores usan el color de la americana y las mochilas llevan bolsillos laterales y
  cremallera. Las caras cambian al atacar (cejas duras y dientes apretados) y al quedar con
  poca vida (gota de sudor).
- **Armario de 99 trajes**: 11 por personaje, con paletas propias, colores de accesorios,
  capas, cintas, sombreros y aureolas. La vista previa usa el mismo motor de dibujo que el
  juego y cada tarjeta indica el diseño de habilidad del traje. Los efectos de habilidad
  tienen 26 familias visuales y los golpes cuerpo a cuerpo heredan el color del traje.
  Las IA también pueden lucir cualquier traje de su personaje, con su variante de color y
  sus efectos de habilidad, para que cada partida se vea distinta. Los seis trajes nuevos
  de cada personaje añaden animaciones de balanceo, rebote, flotación, brillo, pulso y
  órbita.
- Diseños de alumnos mejorados: estampados de camiseta (onda, estrella, bolsillo, parche),
  manchas y migas de Ipa, pecas de Elías, ojeras de Morante, cadenas, muñequeras, calcetines,
  pantalón corto, peinados con raya/mechones/rapado, parpadeo y expresiones animadas.
- **Selección de personaje con avatar**: cada tarjeta muestra el retrato del personaje
  (dibujado con el mismo motor del juego) **encima del nombre**, la descripción, las
  estadísticas y todas sus habilidades. Los estudiantes de la IA se reparten sin repetir
  hasta donde permite el plantel (con 7 estudiantes y 6 modelos, solo se repite uno).
- Animaciones: cada partida abre con una **presentación de los tres profesores** en un
  escenario nocturno, con focos, frases y sus trajes equipados (se puede saltar con ESPACIO
  o un clic). Después, Ipa **come su bocadillo** (mordiscos, migas y «¡ÑAM!»), el Profe Quispe
  **habla, embiste, se peina** y brilla con el peine, sus invocados copian los peinazos y
  las embestidas, Jonny baila, Morante se esfuma o roba una habilidad, Elías activa su burbuja,
  Luis da el reglazo o grita «¿Por cuál página vas?» con su onda, Cáceres grita por el megáfono,
  se intercambia con otro profesor dejando un aura negra o desaparece, y las invocaciones
  aparecen con humo espectral. Los golpes cuerpo a cuerpo tienen una **pose de barrido** con
  lanzamiento del cuerpo, estela del arma, chispas y arcos de impacto: Agendazo, Peine regla,
  Reglazo, golpes de los invocados y embestida de Quispe. Si Morante roba el Reglazo, se le
  ve usar una regla prestada. Al terminar, el bando ganador tiene su **animación de
  celebración** con confeti, brazos arriba, focos y bocadillos: los profesores celebran con
  música, y los **estudiantes supervivientes** lo hacen con estrellas, saltos y su propio
  escenario verde. Los alumnos eliminados no aparecen en el festejo.
- Las IA repetidas reciben **variantes de color** (camiseta, pelo y piel) para distinguirlas.
- Las misiones tienen **atriles y pads** en 14 aulas y salas, marcadores flotantes,
  aviso de **−20 s**, **REFUERZO** o **TAREA** en el HUD y puntos en el minimapa. Las
  tareas de limpieza muestran sus objetos en el mundo y en el minimapa. Los apuntes
  normales y dorados también aparecen en el minimapa.
- Decoración: pizarras con tiza, carteles, relojes, taquillas, plantas, bancos, escenario,
  cabinas, canastas, marcador, árboles, fuente y **puestos de comida** en el patio. Las aulas
  y el patio se han reorganizado para que sofás, máquinas, gradas, taquillas y demás objetos
  no se solapen.
- IA de estudiantes que **evalúa 32 puntos de huida** (dos anillos de distancia) según el
  espacio abierto, la visibilidad desde cada profesor, la separación de sus compañeros y su
  dirección actual; elige rutas por **BFS** para cruzar puertas, usa sus habilidades según la
  distancia y la vida, y hace un **desvío lateral** si se queda atascada.
- Los profesores **predicen la huida**, se reparten objetivos con memoria (no cambian de presa
  cada frame), intentan **rodear** al alumno y persiguen su **última posición conocida** por
  BFS en vez de atravesar paredes. Usan sus habilidades con ángulo, alcance y línea de visión;
  Cáceres grita a distancia, busca al compañero mejor colocado para plantar su aura negra y
  desaparece cuando está en peligro; Quispe busca una **línea de embestida despejada**, y sus
  invocados atacan en pinza y se separan para no amontonarse. **Patrullan pasillos y aulas de
  día** y **hacen rondas por el patio de noche**.
- Detección por **línea de visión** (Bresenham sobre el grid): los profesores no ven a través
  de las paredes.
- Ciclo día/noche: **8:00** de partida, empieza de día y cambia cada **2:00**; capa de
  oscuridad con luces dinámicas (jugador y lámparas del colegio).
- HUD: reloj, marcador, habilidades con recarga (una o dos según el estudiante), **píldoras
  de estado** (inmune, lento, baile, impulso de Luis…), vida y minimapa.
