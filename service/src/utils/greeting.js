import jinam from "./greeting_content/jinam.js";
import swalakshya from "./greeting_content/swalakshya.js";

const APPS = { jinam, swalakshya };

export function buildGreetingAnswer({ script, email, app }) {
  const content = APPS[String(app || "").toLowerCase()] || APPS.jinam;
  const contact = email || content.contactEmail;
  const isDevanagari = String(script || "").toLowerCase() === "devanagari";
  const template = isDevanagari ? content.devanagari : content.latin;
  const followUpQuestions = isDevanagari ? buildSuggestedQuestions().devanagari : buildSuggestedQuestions().latin;

  const answer = template.join("\n").replaceAll("{{CONTACT}}", contact);

  return { answer, followUpQuestions };
}

function buildSuggestedQuestions() {
  const english = [
    "What is Nishchay Nay? Explain in detail.",
    "What are the different properties of Atma?",
    "What is the nature of Gyaan Guna. Explain in detail.",
    "What are the different types of Karma?",
    "Who is a true Jain?",
    "What is the nature of Panch Parmeshthis?",
    "How practical is Jain Dharma?",
    "What is the difference b/w Nimitt and Upadaan? Explain in detail.",
    "What are the 28 moolgunas of saadhu parmeshthi?",
    "What is the nature of Nigodiya Jeev?",
    "What is the nature of soul according to Pravachansaar Ji Granth?",
    "How many types of Mokhsa Marg are there?",
    "What is the difference b/w Shraddha and Gyaan?"
  ];
  const hindiLatin = [
    "Nishchay aur Vyavahar ka swaroop kya hai?",
    "Atma ka swaroop kya hai? Vistaar se samjhaein",
    "Sachha dharma kya hai?",
    "Saat tattva kon konse hai? Vistaar se samjhaein",
    "Jeev kya hai aur ajiv kya hai?",
    "Samyak darshan aur mithya darshan me kya bhed hai?",
    "Ashrav tattva ka swaroop kya hai? Vistaar se samjhaein",
    "Acharya kundkund ne konse granth likhe hain?",
    "Charnanuyoga ke kuch granth bataiye",
    "Kevalgyaan ka kya swaroop hai? Vistaar se samjhaein",
    "Chah dravyon ka swaroop kya hai?",
    "Samaysaar shastra ke aadhar par atma ka swaroop bataiye",
    "Dwidal khaane me kya dosh hai?"
  ];
  const hindiDevanagari = [
    'पुण्य और पाप में क्या अंतर है?',
    'घाति कर्म और अघाति कर्म में क्या अंतर है?',
    'शलाका पुरुष कितने है? उनके भेद बताइए',
    'कर्म कैसे बँधते हैं? विस्तार से समझायें',
    'ज्ञान और राग कैसे भिन्न है?',
    'आत्मानुभूति का उपाय क्या है? विस्तार से समझायें',
    'समयसार किसने लिखा है?',
    'श्रद्धा और ज्ञान में क्या फ़र्क़ है? विस्तार से समझायें',
    'सच्चा सुख क्या है?',
    'जैन धर्म क्या है? विस्तार से समझायें',
    'आचार्य कुन्दकुन्द की विदेह क्षेत्र यात्रा',
    'मोक्षमार्ग क्या है?',
    'चारित्र क्या है? विस्तार से समझायें',
    'विकल्प और विचार में क्या भेद है?',
    'गुणस्थान विवेचन पुस्तक के आधार पर गुणस्थानों का सारांश बताएँ',
  ];

  const pick = (list) => {
    const rand = typeof Math.random === "function" ? Math.random() : 0;
    return list[Math.floor(rand * list.length)];
  };

  return {
    latin: [pick(english), pick(hindiLatin), pick(hindiDevanagari)],
    devanagari: [pick(hindiDevanagari), pick(hindiLatin), pick(english)],
  };
}
