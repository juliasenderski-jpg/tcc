/* ==================================================
   CONFIGURAÇÃO E ELEMENTOS
================================================== */

const LIMITE_RESERVA = 30;
const LIMITE_DIA = 48;
const TEMPO_MENSAGEM = 5000;

const CHAVE_RESERVAS = "reservasReinoDragoes";
const CHAVE_AVISOS = "avisosReinoDragoes";

const form = document.getElementById("formReserva");
const campoData = document.getElementById("data");
const mensagem = document.getElementById("mensagem");
const listaReservas = document.getElementById("listaReservas");
const listaAvisos = document.getElementById("listaAvisos");
const contador = document.getElementById("contador");


/* ==================================================
   UTILITÁRIOS
================================================== */

function dataHoje() {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, "0");
    const dia = String(hoje.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
}

function formatarData(data) {
    const partes = String(data || "").split("-");
    if (partes.length !== 3) return "--";
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function formatarDataHora(valor) {
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "Data inválida";
    return data.toLocaleString("pt-BR");
}

function escapar(texto) {
    return String(texto ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function obterReservas() {
    try {
        return JSON.parse(localStorage.getItem(CHAVE_RESERVAS)) || [];
    } catch (erro) {
        return [];
    }
}

function obterAvisos() {
    try {
        return JSON.parse(localStorage.getItem(CHAVE_AVISOS)) || [];
    } catch (erro) {
        return [];
    }
}

function salvarDados(reservas, avisos) {
    localStorage.setItem(CHAVE_RESERVAS, JSON.stringify(reservas));
    localStorage.setItem(CHAVE_AVISOS, JSON.stringify(avisos));
}

function limparReservasCanceladas() {
    const reservas = obterReservas();
    const ativas = reservas.filter((reserva) => reserva.status !== "Cancelada");

    if (ativas.length !== reservas.length) {
        localStorage.setItem(CHAVE_RESERVAS, JSON.stringify(ativas));
    }
}

function limparAvisosAntigos() {
    const avisosAtuais = obterAvisos();
    const avisosValidos = avisosAtuais.filter((aviso) => {
        if (!aviso || !aviso.data) return false;
        return !Number.isNaN(new Date(aviso.data).getTime());
    });

    if (avisosValidos.length !== avisosAtuais.length) {
        localStorage.setItem(CHAVE_AVISOS, JSON.stringify(avisosValidos));
    }
}

function mostrarMensagem(texto, tipo) {
    mensagem.textContent = texto;
    mensagem.className = `mensagem ${tipo}`;

    setTimeout(() => {
        mensagem.className = "mensagem";
    }, TEMPO_MENSAGEM);
}

function podeCancelar(reserva) {
    const dataReserva = new Date(`${reserva.data}T19:00:00`);
    const agora = new Date();
    const diferencaEmHoras = (dataReserva - agora) / (1000 * 60 * 60);
    return diferencaEmHoras >= 48;
}

function criarAviso({ reservaId, nome, email, tipo, mensagem }) {
    return {
        id: Date.now() + Math.random(),
        reservaId,
        nome,
        email,
        gmail: email,
        tipo,
        mensagem,
        data: new Date().toISOString()
    };
}


/* ==================================================
   NAVEGAÇÃO
================================================== */

function mostrarPagina(pagina) {
    const paginaReserva = document.getElementById("paginaReserva");
    const paginaConfirmadas = document.getElementById("paginaConfirmadas");
    const paginaFuncionarios = document.getElementById("paginaFuncionarios");

    const btnReserva = document.getElementById("btnReserva");
    const btnConfirmadas = document.getElementById("btnConfirmadas");
    const btnFuncionarios = document.getElementById("btnFuncionarios");

    [paginaReserva, paginaConfirmadas, paginaFuncionarios].forEach((paginaAtual) => {
        paginaAtual.classList.remove("ativa");
    });

    [btnReserva, btnConfirmadas, btnFuncionarios].forEach((botao) => {
        botao.classList.remove("ativo");
    });

    if (pagina === "reserva") {
        paginaReserva.classList.add("ativa");
        btnReserva.classList.add("ativo");
        return;
    }

    if (pagina === "confirmadas") {
        paginaConfirmadas.classList.add("ativa");
        btnConfirmadas.classList.add("ativo");
        mostrarReservas();
        mostrarAvisos();
        return;
    }

    if (pagina === "funcionarios") {
        paginaFuncionarios.classList.add("ativa");
        btnFuncionarios.classList.add("ativo");
        atualizarPainelFuncionarios();
    }
}

function abrirPainelFuncionarios() {
    mostrarPagina("funcionarios");
}


/* ==================================================
   CRIAÇÃO DE RESERVA
================================================== */

function validarDadosReserva({ nome, email, telefone, data, pessoas }) {
    if (nome.length < 3) {
        return { valido: false, mensagem: "Informe um nome válido.", tipo: "erro" };
    }

    if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
        return { valido: false, mensagem: "Informe um Gmail válido (ex.: nome@gmail.com).", tipo: "erro" };
    }

    if (!telefone) {
        return { valido: false, mensagem: "Informe o telefone.", tipo: "erro" };
    }

    if (!data || data < dataHoje()) {
        return { valido: false, mensagem: "Não é possível reservar datas passadas.", tipo: "erro" };
    }

    if (pessoas < 1 || pessoas > LIMITE_RESERVA) {
        return { valido: false, mensagem: "O máximo permitido é 30 pessoas por reserva.", tipo: "erro" };
    }

    const dataHora = new Date(`${data}T23:59:59`);
    if (dataHora <= new Date()) {
        return { valido: false, mensagem: "Escolha um horário futuro.", tipo: "erro" };
    }

    return { valido: true };
}

form.addEventListener("submit", function(event) {
    event.preventDefault();

    const nome = document.getElementById("nome").value.trim();
    const email = document.getElementById("email").value.trim();
    const telefone = document.getElementById("telefone").value.trim();
    const data = document.getElementById("data").value;
    const pessoas = Number(document.getElementById("pessoas").value);

    const validacao = validarDadosReserva({ nome, email, telefone, data, pessoas });
    if (!validacao.valido) {
        mostrarMensagem(validacao.mensagem, validacao.tipo);
        return;
    }

    const reservas = obterReservas();
    const totalNoDia = reservas
        .filter((reserva) => reserva.data === data && reserva.status === "Confirmada")
        .reduce((total, reserva) => total + Number(reserva.pessoas), 0);

    if (totalNoDia + pessoas > LIMITE_DIA) {
        mostrarMensagem("⚠ O limite de 48 pessoas para este dia foi atingido.", "erro");
        return;
    }

    const gmailExistente = reservas.some((reserva) => {
        const emailSalvo = String(reserva.gmail || reserva.email || "").toLowerCase();
        return emailSalvo === email.toLowerCase() && reserva.status === "Confirmada";
    });

    if (gmailExistente) {
        mostrarMensagem("Este Gmail já possui uma reserva confirmada.", "erro");
        return;
    }

    const id = Date.now();
    const reserva = {
        id,
        nome,
        gmail: email,
        email,
        telefone,
        data,
        pessoas,
        status: "Confirmada",
        criadaEm: new Date().toISOString()
    };

    reservas.push(reserva);

    const avisos = obterAvisos();
    avisos.push(
        criarAviso({
            reservaId: id,
            nome,
            email,
            tipo: "CONFIRMAÇÃO",
            mensagem: `Olá ${nome}! Sua reserva foi confirmada para ${formatarData(data)} com ${pessoas} pessoa(s).`
        })
    );

    salvarDados(reservas, avisos);
    form.reset();
    campoData.min = dataHoje();

    mostrarMensagem("Reserva confirmada com sucesso!", "sucesso");
    mostrarReservas();
    mostrarAvisos();
});


/* ==================================================
   LISTAGEM DE RESERVAS
================================================== */

function adicionarReserva(reserva) {
    const card = document.createElement("div");
    card.className = "cardReserva";

    let botoes = "";
    if (reserva.status === "Confirmada") {
        botoes = podeCancelar(reserva)
            ? `<button class="btnCancelar" onclick="cancelarReserva(${reserva.id})">Cancelar Reserva</button>`
            : `<p class="status">⚠ O cancelamento está bloqueado.<br>É necessário cancelar com pelo menos 48 horas de antecedência.</p>`;
    }

    card.innerHTML = `
        <h3>${escapar(reserva.nome)}</h3>
        <p><strong>Email:</strong> ${escapar(reserva.email)}</p>
        <p><strong>Telefone:</strong> ${escapar(reserva.telefone)}</p>
        <p><strong>Pessoas:</strong> ${reserva.pessoas}</p>
        <p class="status"><strong>⚔ Status:</strong> ${escapar(reserva.status)}</p>
        ${botoes}
    `;

    listaReservas.appendChild(card);
}

function mostrarReservas() {
    const reservas = obterReservas();
    listaReservas.innerHTML = "";

    const confirmadas = reservas.filter((reserva) => reserva.status === "Confirmada");
    contador.innerHTML = `<strong>${confirmadas.length}</strong> reserva(s) confirmada(s)`;

    if (confirmadas.length === 0) {
        listaReservas.innerHTML = '<p class="vazio">Nenhuma reserva confirmada.</p>';
        return;
    }

    confirmadas
        .slice()
        .sort((a, b) => new Date(`${a.data}T00:00:00`) - new Date(`${b.data}T00:00:00`))
        .forEach(adicionarReserva);
}


/* ==================================================
   CANCELAMENTO
================================================== */

function cancelarReserva(id) {
    const reservas = obterReservas();
    const avisos = obterAvisos();
    const reserva = reservas.find((item) => String(item.id) === String(id) && item.status === "Confirmada");

    if (!reserva) {
        alert("Esta reserva já foi cancelada ou não foi encontrada.");
        return;
    }

    if (!podeCancelar(reserva)) {
        alert("O cancelamento só é permitido com 48 horas ou mais de antecedência.");
        return;
    }

    const confirmar = confirm(`Deseja cancelar a reserva de ${reserva.nome}?`);
    if (!confirmar) return;

    avisos.push(
        criarAviso({
            reservaId: reserva.id,
            nome: reserva.nome,
            email: reserva.email,
            tipo: "CANCELAMENTO",
            mensagem: `A reserva de ${reserva.nome}, marcada para ${formatarData(reserva.data)}, foi cancelada com sucesso.`
        })
    );

    const reservasAtualizadas = reservas.filter((item) => String(item.id) !== String(reserva.id));
    salvarDados(reservasAtualizadas, avisos);

    mostrarReservas();
    mostrarAvisos();
    atualizarPainelFuncionarios();
    mostrarMensagem("Reserva cancelada. O Gmail já pode ser usado novamente.", "sucesso");
}


/* ==================================================
   AVISOS
================================================== */

function mostrarAvisos() {
    const avisos = obterAvisos();
    listaAvisos.innerHTML = "";

    if (avisos.length === 0) {
        listaAvisos.innerHTML = '<p class="vazio">Nenhum aviso novo.</p>';
        return;
    }

    avisos
        .slice()
        .reverse()
        .forEach((aviso) => {
            const elemento = document.createElement("div");
            elemento.className = "aviso";
            elemento.innerHTML = `
                <h3>${escapar(aviso.tipo)}</h3>
                <p>${escapar(aviso.mensagem)}</p>
                <p><strong>Aviso:</strong> ${formatarDataHora(aviso.data)}</p>
            `;
            listaAvisos.appendChild(elemento);
        });
}


/* ==================================================
   PAINEL DOS FUNCIONÁRIOS
================================================== */

function atualizarPainelFuncionarios() {
    const lista = document.getElementById("listaReservasFuncionarios");
    const avisosLista = document.getElementById("listaAvisosFuncionarios");
    if (!lista || !avisosLista) return;

    const filtroData = document.getElementById("filtroDataFuncionario").value;
    const filtroNome = document.getElementById("filtroNomeFuncionario").value.trim().toLowerCase();

    const reservas = obterReservas()
        .filter((reserva) => {
            if (reserva.status !== "Confirmada") return false;

            const nome = String(reserva.nome || "").toLowerCase();
            const gmail = String(reserva.gmail || reserva.email || "").toLowerCase();

            if (filtroData && reserva.data !== filtroData) return false;
            if (filtroNome && !nome.includes(filtroNome) && !gmail.includes(filtroNome)) return false;

            return true;
        })
        .sort((a, b) => new Date(`${a.data}T00:00:00`) - new Date(`${b.data}T00:00:00`));

    const todas = obterReservas().filter((reserva) => reserva.status === "Confirmada");
    const totalPessoas = todas.reduce((total, reserva) => total + Number(reserva.pessoas || 0), 0);
    const cancelamentos = obterAvisos().filter((aviso) => aviso.tipo === "CANCELAMENTO");

    document.getElementById("totalAtivasFuncionario").textContent = todas.length;
    document.getElementById("totalPessoasFuncionario").textContent = totalPessoas;
    document.getElementById("totalCancelamentosFuncionario").textContent = cancelamentos.length;

    lista.innerHTML = "";
    if (reservas.length === 0) {
        lista.innerHTML = '<div class="sem-resultados">📜 Nenhuma reserva encontrada para os filtros selecionados.</div>';
    } else {
        reservas.forEach((reserva) => {
            const card = document.createElement("div");
            card.className = "reserva-funcionario";
            card.innerHTML = `
                <h3>👤 ${escapar(reserva.nome)} <span class="tag-nova">CONFIRMADA</span></h3>
                <div class="linha-reserva">
                    <p><strong>Data:</strong> ${formatarData(reserva.data)}</p>
                    <p><strong>Pessoas:</strong> ${Number(reserva.pessoas)}</p>
                    <p><strong>Gmail:</strong> ${escapar(reserva.gmail || reserva.email)}</p>
                    <p><strong>Telefone:</strong> ${escapar(reserva.telefone)}</p>
                </div>
                <p class="data-recebimento">Reserva recebida em ${formatarDataHora(reserva.criadaEm)} • ID: ${escapar(reserva.id)}</p>
            `;
            lista.appendChild(card);
        });
    }

    avisosLista.innerHTML = "";
    const avisos = obterAvisos().slice().reverse();

    if (avisos.length === 0) {
        avisosLista.innerHTML = '<div class="sem-resultados">Nenhuma notificação registrada.</div>';
        return;
    }

    avisos.forEach((aviso) => {
        const item = document.createElement("div");
        item.className = `aviso-funcionario${aviso.tipo === "CANCELAMENTO" ? " cancelamento" : ""}`;
        item.innerHTML = `
            <h3>${aviso.tipo === "CANCELAMENTO" ? "❌" : "🔔"} ${escapar(aviso.tipo)}</h3>
            <p>${escapar(aviso.mensagem)}</p>
            <p><strong>Gmail:</strong> ${escapar(aviso.gmail || aviso.email || "Não informado")}</p>
            <p><strong>Registrado em:</strong> ${formatarDataHora(aviso.data)}</p>
        `;
        avisosLista.appendChild(item);
    });
}

function limparFiltrosFuncionario() {
    document.getElementById("filtroDataFuncionario").value = "";
    document.getElementById("filtroNomeFuncionario").value = "";
    atualizarPainelFuncionarios();
}


/* ==================================================
   SINCRONIZAÇÃO E INICIALIZAÇÃO
================================================== */

window.addEventListener("storage", function(event) {
    if (event.key === CHAVE_RESERVAS || event.key === CHAVE_AVISOS) {
        mostrarReservas();
        mostrarAvisos();
        atualizarPainelFuncionarios();
    }
});

campoData.min = dataHoje();
limparReservasCanceladas();
limparAvisosAntigos();
mostrarReservas();
mostrarAvisos();
atualizarPainelFuncionarios();
