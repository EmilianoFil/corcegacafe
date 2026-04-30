/**
 * Componente Footer para Tienda Córcega
 * Carga la configuración desde Firestore y renderiza el footer en todas las páginas de la tienda.
 */
import { db } from '../firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const FILGUEIRA_LOGO = `<a href="https://filgueira.dev" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;vertical-align:middle;opacity:1;transition:opacity .2s" onmouseover="this.style.opacity='.65'" onmouseout="this.style.opacity='1'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 580 100" height="14" aria-label="Filgueira.dev"><polygon points="45,5 84,27.5 84,72.5 45,95 6,72.5 6,27.5" fill="#D94040"/><text x="45" y="70" text-anchor="middle" font-family="Arial Black,sans-serif" font-size="54" font-weight="900" fill="white">F</text><text x="100" y="76" font-family="Arial,Helvetica,sans-serif" font-size="66" font-weight="700"><tspan fill="#1a1a1a">Filgueira</tspan><tspan fill="#D94040">.dev</tspan></text></svg></a>`;

const SOCIAL_ICONS = {
    instagram: 'fa-brands fa-instagram',
    facebook:  'fa-brands fa-facebook',
    tiktok:    'fa-brands fa-tiktok',
    twitter:   'fa-brands fa-x-twitter',
    whatsapp:  'fa-brands fa-whatsapp',
};

function renderFooter(config) {
    const footerEl = document.getElementById('main-footer');
    if (!footerEl) return;

    const info  = config?.info  || {};
    const redes = config?.redes || {};
    const year  = new Date().getFullYear();

    // --- Address block ---
    let addressHTML = '';
    if (info.direccion) {
        const mapsUrl = info.googleMapsUrl || '#';
        addressHTML = `
        <div class="tienda-footer-address">
            <a href="${mapsUrl}" target="_blank" rel="noopener">
                <i class="fas fa-map-marker-alt"></i>
                ${info.direccion}
                <i class="fas fa-arrow-up-right-from-square" style="font-size:10px; opacity:0.6;"></i>
            </a>
        </div>`;
    }

    // --- Social icons ---
    const socialLinks = [];

    // Network accounts (instagram, facebook, tiktok, twitter)
    ['instagram', 'facebook', 'tiktok', 'twitter'].forEach(red => {
        const data = redes[red];
        if (data?.activo && data?.url) {
            socialLinks.push({ url: data.url, icon: SOCIAL_ICONS[red] });
        }
    });

    // WhatsApp from info block
    if (info.whatsapp) {
        socialLinks.push({
            url: `https://wa.me/${info.whatsapp}`,
            icon: SOCIAL_ICONS.whatsapp,
        });
    }

    let socialsHTML = '';
    if (socialLinks.length > 0) {
        const links = socialLinks.map(s =>
            `<a href="${s.url}" target="_blank" rel="noopener" class="footer-social-btn"><i class="${s.icon}"></i></a>`
        ).join('');
        socialsHTML = `<div class="tienda-footer-socials">${links}</div>`;
    }

    footerEl.innerHTML = `
    <div class="tienda-footer-main">
        <div class="tienda-footer-inner">
            <div class="tienda-footer-brand">
                <span class="footer-brand-name">CóRCEGA</span>
                <span class="footer-brand-sub">REBELDÍA CAFETERA</span>
            </div>
            ${addressHTML}
            ${socialsHTML}
        </div>
    </div>
    <div class="tienda-footer-bottom">
        © ${year} Córcega Café &nbsp;·&nbsp; Hecho con <span style="color:#ed7053">♥</span> por ${FILGUEIRA_LOGO}
    </div>`;
}

function renderMinimalFooter() {
    const footerEl = document.getElementById('main-footer');
    if (!footerEl) return;
    const year = new Date().getFullYear();
    footerEl.innerHTML = `
    <div class="tienda-footer-main">
        <div class="tienda-footer-inner">
            <div class="tienda-footer-brand">
                <span class="footer-brand-name">CóRCEGA</span>
                <span class="footer-brand-sub">REBELDÍA CAFETERA</span>
            </div>
        </div>
    </div>
    <div class="tienda-footer-bottom">
        © ${year} Córcega Café &nbsp;·&nbsp; Hecho con <span style="color:#ed7053">♥</span> por ${FILGUEIRA_LOGO}
    </div>`;
}

export async function initFooter() {
    const footerEl = document.getElementById('main-footer');
    if (!footerEl) return;

    try {
        const snap = await getDoc(doc(db, "configuracion", "tienda"));
        const config = snap.exists() ? snap.data() : {};
        renderFooter(config);
    } catch (err) {
        console.warn("Footer: no se pudo cargar config de Firestore, usando versión mínima.", err);
        renderMinimalFooter();
    }
}

// Auto-inicializar
document.addEventListener('DOMContentLoaded', () => {
    if (!window.footerInitialized) {
        initFooter();
        window.footerInitialized = true;
    }
});
