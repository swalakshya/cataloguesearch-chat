export function buildGreetingAnswer({ script, email }) {
  const contact = email || "projectjinam@gmail.com";
  const suggested = buildSuggestedQuestions();
  if (String(script || "").toLowerCase() === "devanagari") {
    return [
      "*जय जिनेन्द्र!*",
      "",
      "`JINAM Chatbot` में आपका स्वागत है। यह प्लेटफॉर्म जैन दर्शन, मूल्यों और इतिहास को समझने के इच्छुक जिज्ञासुओं के लिए समर्पित है।",
      "",
      "_हमारा लक्ष्य प्राचीन शास्त्रों में संरक्षित आचार्यों और मुनिराजों के शाश्वत ज्ञान को तथा आधुनिक जैन विद्वानों के समर्पित प्रयासों को, सरल और सुगम भाषा में आप तक पहुँचाना है।_",
      "",
      "आप जैन धर्म से संबंधित अपने प्रश्न को हिंदी या अंग्रेजी में पूछ सकते हैं, जैसे -",
      "",
      ...suggested.devanagari,
      "",
      "जैन धर्म और आत्म-बोध की इस सार्थक खोजपूर्ण यात्रा के लिए हमारी मंगल भावनाएँ।",
      "",
      "सधन्यवाद,",
      "टीम JINAM",
      "(```TATTVAM``` और ```Origen Systems``` की एक पहल)",
      `सुझाव: ${contact}`,
      "",
      "`कृपया ध्यान दें:`",
      "```JINAM Chatbot``` केवल एक सहायक है, जो उत्तरों के साथ जैन ग्रंथों के संदर्भ प्रदान करता है। इसमें त्रुटियाँ हो सकती हैं—कृपया प्रत्येक उत्तर के साथ दिए गए मूल ग्रंथों पर ही विश्वास करें।"
    ].join("\n");
  }

  return [
    "*Jai Jinendra!*",
    "",
    "Welcome to `JINAM Chatbot`. This platform is dedicated to helping seekers explore Jain philosophy, values, and history.",
    "",
    "_Our mission is to guide you through the timeless wisdom of our Acharyas and Munirajas as preserved in ancient scriptures, supported by the dedicated efforts of modern Jain scholars in simple, accessible language._",
    "",
    "You may ask your questions related to Jainism in either English or Hindi. Try asking:",
    "",
    ...suggested.latin,
    "",
    "We wish you a meaningful journey of discovering Jainism and the self.",
    "",
    "Thanks,",
    "Team JINAM",
    "(An initiative by ```TATTVAM``` and ```Origen Systems```)",
    `Feedback: ${contact}`,
    "",
    "`PLEASE NOTE:`",
    "```JINAM Chatbot``` is only an *assistant* in providing answers along-with the references to Jain Texts. It may make mistakes. Only trust the original literature cited with each answer."
  ].join("\n");
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
    latin: [
      `> ${pick(english)}`,
      `> ${pick(hindiLatin)}`,
      `> ${pick(hindiDevanagari)}`,
    ],
    devanagari: [
      `> ${pick(hindiDevanagari)}`,
      `> ${pick(hindiLatin)}`,
      `> ${pick(english)}`,
    ],
  };
}
