// Número do WhatsApp (DDI + DDD + número, só dígitos). Ex.: "5511999998888".
// Enquanto estiver vazio, os botões levam à seção de contato em vez de abrir um link quebrado.
const WHATSAPP = "";

document.documentElement.classList.add("js");
document.getElementById("y").textContent = new Date().getFullYear();

document.querySelectorAll("[data-wa]").forEach(a => {
  if (!WHATSAPP) return;
  a.href = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(a.dataset.wa)}`;
  a.target = "_blank";
  a.rel = "noopener";
});

const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  });
}, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
document.querySelectorAll(".reveal").forEach(el => io.observe(el));

const fab = document.getElementById("fab");
const onScroll = () => fab.classList.toggle("on", scrollY > 600);
addEventListener("scroll", onScroll, { passive: true });
onScroll();
