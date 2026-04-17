/**
 * Componente Footer para Tienda Córcega
 * Carga la configuración desde Firestore y renderiza el footer en todas las páginas de la tienda.
 */
import { db } from '../firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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
        © ${year} Córcega Café &nbsp;·&nbsp; Hecho con <span style="color:#ed7053">♥</span> por <a href="https://wa.me/5491136053892" target="_blank" rel="noopener">LENUAhub</a>
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
        © ${year} Córcega Café &nbsp;·&nbsp; Hecho con <span style="color:#ed7053">♥</span> por <a href="https://wa.me/5491136053892" target="_blank" rel="noopener">LENUAhub</a>
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
