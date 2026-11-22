# Luma Hojas de cálculo

Luma es una hoja de cálculo web de código abierto para escritorio y dispositivos táctiles. Incluye un libro de ejemplo con fórmulas entre hojas. Los libros se procesan y se guardan en el navegador mediante IndexedDB.

## Ejecutar

1. Descomprime el proyecto. En una terminal, entra en la carpeta que contiene index.html.
2. Ejecuta python3 -m http.server 8000.
3. Abre http://localhost:8000. No se requiere instalar dependencias ni ejecutar una compilación.
4. Para instalar la PWA, usa la opción de instalación del navegador. En iOS, abre la aplicación en Safari y elige **Añadir a pantalla de inicio**. La caché offline se instala al abrir la página por primera vez. Usa HTTPS si accedes desde otra máquina.

## Edición

- Haz doble clic, doble toque o pulsa F2 para editar una celda. También puedes editar en la barra ƒx. Escape cancela, Enter baja y Tab avanza.
- Las flechas mueven la selección. Con Mayús amplían el rango y con Ctrl o Cmd + clic puedes agregar rangos independientes. En móvil, activa **Rango** para seleccionar arrastrando. Desactívalo para desplazarte con un dedo.
- Arrastra los bordes de los encabezados para redimensionarlos. Arrastra el cuadrado verde de la selección para repetir datos y ajustar las referencias relativas. El relleno conserva los anclajes con $ y repite el patrón seleccionado.
- Usa Ctrl o Cmd + C, X y V para copiar, cortar y pegar. El texto tabulado del portapapeles permite pegar selecciones de Excel. El portapapeles interno también conserva fórmulas y formatos en navegadores que reciben el formato personalizado.
- Usa Ctrl o Cmd + Z para deshacer, Ctrl o Cmd + Y para rehacer y Ctrl o Cmd + B para aplicar negrita. Los cambios de formato se aplican a todos los rangos seleccionados. Las operaciones de portapapeles usan el rango principal.
- Escribe =SUMA( y arrastra sobre el rango para incluir su referencia. Cierra con paréntesis y pulsa Enter. Para funciones sugeridas, pulsa Tab o elige el nombre. Ejemplos entre hojas y con referencias absolutas o mixtas:

  ~~~text
  =SUMA('Hoja 1'!D2:D4)
  =SI(B2>10;"Pedido grande";"Pedido normal")
  =BUSCARV(A2;'Hoja 2'!$A$1:$D$10;3;FALSO)
  =B2*$C$1
  ~~~

## Arquitectura

| Ruta | Responsabilidad |
| --- | --- |
| core/grid-model.js | Libro de 12.000 × 1.024 celdas por hoja, con mapas dispersos para datos y dimensiones |
| core/dependency-graph.js | Índice inverso de dependencias puntuales y rectangulares, más orden topológico del subgrafo afectado |
| core/formula-engine.js | Tokenizador, analizador Pratt, AST, evaluación, referencias y errores |
| core/command-manager.js | Comandos reversibles y transacciones de edición por lotes |
| core/function-registry.js | Registro global compartido por todos los motores |
| plugins/functions/ | Implementación de funciones y ejemplo de extensión |
| plugins/standard-functions.js | Registro de aliases en español e inglés |
| ui/ | Canvas virtualizado con DPR, selección, gestos y editor nativo |
| io/ | IndexedDB, portapapeles y formatos de archivo |
| manifest.json y sw.js | Instalación y caché de recursos PWA |

Las referencias circulares se identifican cuando no se puede ordenar topológicamente el subgrafo afectado. El motor muestra #CIRC! en el ciclo y en sus dependientes bloqueados. Después de romper el ciclo recalcula las celdas afectadas. SUMA y otras funciones recorren los rangos bajo demanda sin materializar matrices densas.

## Compatibilidad de archivos y fórmulas

CSV exporta valores de la hoja activa. XLSX exporta todas las hojas, fórmulas de las funciones estándar y formatos numéricos comunes. Los estilos visuales de celdas se conservan en IndexedDB. La aplicación implementa un subconjunto de Excel, con 20 funciones bilingües, operadores, comparaciones, texto, números, booleanos y rangos rectangulares. La sintaxis admite puntos decimales dentro de las fórmulas y separadores de argumentos de coma o punto y coma. HOY devuelve el número de serie de fecha de Excel y se actualiza al recalcular la celda o al reabrir el libro. Aplica **Fecha** para mostrarla como fecha.

SheetJS CE 0.20.3 se distribuye localmente para habilitar XLSX y CSV desde la primera carga offline después de instalar la caché. Su origen es https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js y su licencia Apache 2.0 está en assets/SHEETJS-LICENSE. El código de Luma usa la licencia MIT.

## GitHub Pages

1. Crea un repositorio en GitHub y sube el contenido de esta carpeta a main.
2. Abre **Settings → Pages** y selecciona **Deploy from a branch**.
3. Selecciona **main**, el directorio **/(root)** y pulsa **Save**.
4. Abre la URL de Pages cuando termine el despliegue. Los paths relativos funcionan bajo el subdirectorio del repositorio.
5. Cuando cambies recursos cacheados, actualiza la versión CACHE en sw.js para publicar un nuevo conjunto offline.

## Añadir una función

1. Crea plugins/functions/doble.js e importa el registro y la coerción numérica del motor.
2. Registra los nombres y la función en ese módulo:

   ~~~js
   import {FunctionRegistry} from '../../core/function-registry.js';
   import {number} from '../../core/formula-engine.js';

   const double = value => number(value) * 2;
   FunctionRegistry.register('DOBLE', double);
   FunctionRegistry.register('DOUBLE', double);
   ~~~

3. Importa el módulo en app.js antes de instanciar FormulaEngine con import './plugins/functions/doble.js'.
4. Agrega su ruta a SHELL en sw.js, incrementa CACHE y prueba =DOBLE(A1).
5. Si recibe rangos, usa RangeValue como iterable o scalar() para leer su primera celda. Si necesita evaluar argumentos condicionalmente, regístrala con {lazy:true}; recibirá funciones sin argumentos. Las funciones personalizadas necesitan un equivalente reconocido por Excel para recalcular allí.

## Pruebas

Con Node.js 20 o posterior, ejecuta npm test. No necesitas npm install.
