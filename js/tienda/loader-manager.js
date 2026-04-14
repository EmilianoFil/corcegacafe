/**
 * Loader Manager para Tienda Córcega
 * Centraliza el diseño del spinner de carga en toda la web.
 */

export const LoaderManager = {
    /**
     * Retorna el HTML del loader con un texto personalizado.
     * @param {string} text - El texto a mostrar debajo del spinner.
     */
    getHTML: (text = "Cargando...") => {
        LoaderManager.injectStyles();
        return `
            <div class="corcega-loader-container">
                <div class="corcega-spinner">
                    <i class="fas fa-circle-notch fa-spin"></i>
                </div>
                <p class="corcega-loader-text">${text}</p>
            </div>
        `;
    },
    
    /**
     * Inyecta los estilos globales del loader en el head si no existen.
     */
    injectStyles: () => {
        if (document.getElementById('corcega-loader-styles')) return;
        const style = document.createElement('style');
        style.id = 'corcega-loader-styles';
        style.innerHTML = `
            .corcega-loader-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 60px 20px;
                text-align: center;
                gap: 15px;
                animation: fadeInLoader 0.4s ease;
                width: 100%;
            }
            .corcega-spinner {
                font-size: 32px;
                color: var(--naranja-accent, #ed7053);
            }
            .corcega-loader-text {
                font-family: var(--font-display, 'Playfair Display', serif);
                font-size: 16px;
                font-weight: 700;
                color: var(--panel-oscuro, #01323f);
                margin: 0;
                letter-spacing: 0.5px;
            }
            @keyframes fadeInLoader {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }
};
