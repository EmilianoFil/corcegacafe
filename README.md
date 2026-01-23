# 🐎 Córcega Café - Club de Fidelización

Este proyecto es el sistema de gestión de clientes y fidelización de **Córcega Café**. Permite a los clientes sumar "cafecitos" mediante su DNI y recibir recompensas automáticas.

## 🚀 Arquitectura del Proyecto

El sistema está dividido en dos partes principales:

1.  **Frontend (Estático)**: Hosteado en **GitHub Pages**. Desarrollado con HTML, CSS y JavaScript puro (Vanilla JS). Se comunica directamente con Firebase mediante el SDK web.
2.  **Backend (Serverless)**: Hosteado en **Firebase Functions**. Maneja procesos pesados como el envío de correos masivos y tareas programadas (Cron jobs).
3.  **Base de Datos**: **Firestore**. Almacena la información de clientes, el conteo de sellos y los logs de actividad.

---

## 📂 Estructura de Archivos

### Frontend (Raíz)
*   `index.html`: Punto de entrada principal.
*   `registro.html`: Formulario de alta para nuevos clientes.
*   `estado.html`: Vista donde el cliente consulta cuántos cafecitos tiene acumulados.
*   `admin-new.html`: **(Nuevo)** Dash de administración moderno (SPA) con gráficos y gestión centralizada.
*   `panel.html`: Estadísticas clásicas y lanzador de campañas.
*   `admin.html`: Operación rápida de carga de sellos (versión clásica).
*   `js/firebase-config.js`: Configuración central de Firebase (SDK v10).
*   `css/`: Estilos del sitio e imágenes (incluyendo los flyers de campañas).

### Backend (`/functions`)
*   `index.js`: Lógica principal de las Cloud Functions.
*   `enviarMailRegistro`: Mail de bienvenida.
*   `selloCumpleaniosDiario`: Proceso diario (8:00 AM) que regala un sello a los cumpleañeros.
*   `enviarMailAniversario`: **(Nuevo)** Sistema de envío masivo optimizado.

---

## 🖥️ Nuevo Admin Dash (admin-new.html)

Se ha creado una nueva interfaz de administración tipo **SPA (Single Page Application)** con una estética "blanca", limpia y premium.

- **Tecnologías**: HTML5, Vanilla JS, CSS Variables, Chart.js y DataTables.
- **Dashboard Dinámico**: Gráfico de actividad semanal conectado a Firestore que muestra los cafecitos servidos día por día.
- **Secciones Integradas**:
    - **Dashboard**: Vista general de métricas clave.
    - **Sumar Cafecito**: Operación de carga rápida con validación de cumpleaños y sistema de "Deshacer".
    - **Clientes**: Tabla interactiva con búsqueda.
    - **Auditoría**: Historial de logs reciente.
    - **Herramientas**: Enlaces rápidos a utilidades del sistema.

---

## 🎊 Campaña de Aniversario (24/01)

Se implementó un sistema robusto para el envío de correos masivos de aniversario (aprox. 430+ envíos) con las siguientes protecciones:

- **Detección de duplicados**: Cada cliente tiene un campo `mailaniversario` (boolean) en Firestore.
- **Resiliencia**: Si el proceso se detiene, se puede re-lanzar desde el `panel.html` y solo enviará a quienes falten marcar.
- **Monitor en tiempo real**: El panel de administración incluye una barra de progreso que escucha los cambios en la base de datos para mostrar el avance real de los envíos.

---

## 🛠 Mantenimiento y Deploy

### Actualizar el Sitio (Frontend)
Los cambios en los archivos HTML/CSS/JS se suben mediante Git:
```bash
git add .
git commit -m "Descripción del cambio"
git push origin main
```

### Actualizar las Funciones (Backend)
Para subir cambios en la lógica de correos o procesos automáticos:
1. Asegurarse de estar en el proyecto correcto: `firebase use corcega`
2. Deployar: `firebase deploy --only functions`

---

## 🔑 Configuración de Secretos
Los correos se envían usando Gmail. Las credenciales están protegidas en **Google Cloud Secret Manager** bajo los nombres:
- `EMAIL_USER`: Cuenta de envío.
- `EMAIL_PASS`: Contraseña de aplicación de Google.

---
*Desarrollado con rebeldía cafetera por Antigravity / EmilianoFil.* 🐎🏝️☕
