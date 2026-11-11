// Banco de perguntas organizado como os capítulos de uma vida.
// {p} = "a senhora" / "o senhor" / "você"   ({P} = com maiúscula)
export const CHAPTERS = [
  { key: 'infancia', name: 'Infância', questions: [
    'Onde {p} nasceu? Como era o lugar onde {p} cresceu?',
    'Como era a casa da sua infância? Me conta como era um dia comum lá.',
    'Do que {p} mais gostava de brincar quando era criança?',
    'Qual é a lembrança mais antiga que {p} tem?',
    'Tinha alguma comida que marcou a sua infância? Quem fazia?',
    'Como era a escola no seu tempo? Lembra de algum professor?',
  ]},
  { key: 'familia', name: 'Família e raízes', questions: [
    'Me conta sobre os seus pais. Como eles eram?',
    'O que {p} sabe sobre os seus avós? De onde a família veio?',
    'Quantos irmãos {p} teve? Tem alguma história boa com eles?',
    'Tinha alguma tradição na sua família, em festa, Natal ou domingo?',
    'Qual conselho dos seus pais {p} nunca esqueceu?',
  ]},
  { key: 'juventude', name: 'Juventude', questions: [
    'Como era ser jovem no seu tempo? O que a turma fazia para se divertir?',
    'Qual música marcou a sua juventude? Por quê?',
    'Qual foi a maior aventura ou travessura que {p} já fez?',
    'Quem era o seu melhor amigo ou amiga de juventude?',
  ]},
  { key: 'amor', name: 'Amor', questions: [
    'Como {p} conheceu o grande amor da sua vida?',
    'Como foi o primeiro encontro? Lembra onde foi?',
    'Como foi o dia do seu casamento?',
    'Qual o segredo para um amor durar, na sua opinião?',
  ]},
  { key: 'trabalho', name: 'Trabalho e sonhos', questions: [
    'Qual foi o seu primeiro trabalho? Quanto ganhava?',
    'Qual trabalho {p} mais gostou de fazer na vida?',
    'O que {p} sonhava ser quando era jovem?',
    'Qual foi a conquista da qual {p} mais se orgulha?',
  ]},
  { key: 'filhos', name: 'Filhos e netos', questions: [
    'Como foi quando o seu primeiro filho nasceu?',
    'Tem alguma história engraçada de quando os filhos eram pequenos?',
    'O que {p} sente quando vê os netos crescendo?',
    'O que {p} gostaria que os seus netos soubessem sobre {p}?',
  ]},
  { key: 'lugares', name: 'Lugares e mudanças', questions: [
    'Qual lugar do mundo {p} mais gostou de conhecer?',
    'Como a sua cidade mudou desde que {p} era jovem?',
    '{P} já se mudou de cidade? Como foi recomeçar?',
  ]},
  { key: 'desafios', name: 'Força e superação', questions: [
    'Qual foi um momento difícil que {p} superou? O que te deu força?',
    'Teve alguma época em que a vida apertou? Como a família se virou?',
  ]},
  { key: 'alegrias', name: 'Alegrias', questions: [
    'Qual foi o dia mais feliz da sua vida?',
    'O que te faz rir até hoje quando lembra?',
    'Qual a melhor festa que {p} já foi?',
  ]},
  { key: 'sabedoria', name: 'Sabedoria', questions: [
    'Se {p} pudesse dar um conselho para você mesmo(a) com 20 anos, qual seria?',
    'O que é mais importante na vida, na sua opinião?',
    'Como {p} gostaria de ser lembrado(a) pela família?',
  ]},
];

export const chapterName = (key) => CHAPTERS.find(c => c.key === key)?.name || 'Histórias soltas';

export function fill(text, pronoun = 'a senhora') {
  const cap = pronoun.charAt(0).toUpperCase() + pronoun.slice(1);
  return text.replaceAll('{P}', cap).replaceAll('{p}', pronoun);
}

// Próxima pergunta ainda não feita, percorrendo capítulos em rodízio
export function nextQuestion(askedKeys) {
  const asked = new Set(askedKeys);
  const maxLen = Math.max(...CHAPTERS.map(c => c.questions.length));
  for (let i = 0; i < maxLen; i++) {
    for (const ch of CHAPTERS) {
      const key = `${ch.key}:${i}`;
      if (ch.questions[i] && !asked.has(key)) return { key, chapter: ch.key, text: ch.questions[i] };
    }
  }
  return null; // banco esgotado: a IA cria perguntas novas
}
