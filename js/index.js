(function() {

    var FuzzySet = function(arr, useLevenshtein, gramSizeLower, gramSizeUpper) {
        var fuzzyset = {

        };

        // default options
        arr = arr || [];
        fuzzyset.gramSizeLower = gramSizeLower || 2;
        fuzzyset.gramSizeUpper = gramSizeUpper || 3;
        fuzzyset.useLevenshtein = (typeof useLevenshtein !== 'boolean') ? true : useLevenshtein;

        // define all the object functions and attributes
        fuzzyset.exactSet = {};
        fuzzyset.matchDict = {};
        fuzzyset.items = {};

        // helper functions
        var levenshtein = function(str1, str2) {
            var current = [],
                prev, value;

            for (var i = 0; i <= str2.length; i++)
                for (var j = 0; j <= str1.length; j++) {
                    if (i && j)
                        if (str1.charAt(j - 1) === str2.charAt(i - 1))
                            value = prev;
                        else
                            value = Math.min(current[j], current[j - 1], prev) + 1;
                    else
                        value = i + j;

                    prev = current[j];
                    current[j] = value;
                }

            return current.pop();
        };

        // return an edit distance from 0 to 1
        var _distance = function(str1, str2) {
            if (str1 === null && str2 === null) throw 'Trying to compare two null values';
            if (str1 === null || str2 === null) return 0;
            str1 = String(str1);
            str2 = String(str2);

            var distance = levenshtein(str1, str2);
            if (str1.length > str2.length) {
                return 1 - distance / str1.length;
            } else {
                return 1 - distance / str2.length;
            }
        };
        var _nonWordRe = /[^a-zA-Z0-9\u00C0-\u00FF, ]+/g;

        var _iterateGrams = function(value, gramSize) {
            gramSize = gramSize || 2;
            var simplified = '-' + value.toLowerCase().replace(_nonWordRe, '') + '-',
                lenDiff = gramSize - simplified.length,
                results = [];
            if (lenDiff > 0) {
                for (var i = 0; i < lenDiff; ++i) {
                    simplified += '-';
                }
            }
            for (var i = 0; i < simplified.length - gramSize + 1; ++i) {
                results.push(simplified.slice(i, i + gramSize));
            }
            return results;
        };

        var _gramCounter = function(value, gramSize) {
            // return an object where key=gram, value=number of occurrences
            gramSize = gramSize || 2;
            var result = {},
                grams = _iterateGrams(value, gramSize),
                i = 0;
            for (i; i < grams.length; ++i) {
                if (grams[i] in result) {
                    result[grams[i]] += 1;
                } else {
                    result[grams[i]] = 1;
                }
            }
            return result;
        };

        // the main functions
        fuzzyset.get = function(value, defaultValue, minMatchScore) {
            // check for value in set, returning defaultValue or null if none found
            if (minMatchScore === undefined) {
                minMatchScore = .33
            }
            var result = this._get(value, minMatchScore);
            if (!result && typeof defaultValue !== 'undefined') {
                return defaultValue;
            }
            return result;
        };

        fuzzyset._get = function(value, minMatchScore) {
            var normalizedValue = this._normalizeStr(value),
                result = this.exactSet[normalizedValue];
            if (result) {
                return [
                    [1, result]
                ];
            }

            var results = [];
            // start with high gram size and if there are no results, go to lower gram sizes
            for (var gramSize = this.gramSizeUpper; gramSize >= this.gramSizeLower; --gramSize) {
                results = this.__get(value, gramSize, minMatchScore);
                if (results && results.length > 0) {
                    return results;
                }
            }
            return null;
        };

        fuzzyset.__get = function(value, gramSize, minMatchScore) {
            var normalizedValue = this._normalizeStr(value),
                matches = {},
                gramCounts = _gramCounter(normalizedValue, gramSize),
                items = this.items[gramSize],
                sumOfSquareGramCounts = 0,
                gram,
                gramCount,
                i,
                index,
                otherGramCount;

            for (gram in gramCounts) {
                gramCount = gramCounts[gram];
                sumOfSquareGramCounts += Math.pow(gramCount, 2);
                if (gram in this.matchDict) {
                    for (i = 0; i < this.matchDict[gram].length; ++i) {
                        index = this.matchDict[gram][i][0];
                        otherGramCount = this.matchDict[gram][i][1];
                        if (index in matches) {
                            matches[index] += gramCount * otherGramCount;
                        } else {
                            matches[index] = gramCount * otherGramCount;
                        }
                    }
                }
            }

            function isEmptyObject(obj) {
                for (var prop in obj) {
                    if (obj.hasOwnProperty(prop))
                        return false;
                }
                return true;
            }

            if (isEmptyObject(matches)) {
                return null;
            }

            var vectorNormal = Math.sqrt(sumOfSquareGramCounts),
                results = [],
                matchScore;
            // build a results list of [score, str]
            for (var matchIndex in matches) {
                matchScore = matches[matchIndex];
                results.push([matchScore / (vectorNormal * items[matchIndex][0]), items[matchIndex][1]]);
            }
            var sortDescending = function(a, b) {
                if (a[0] < b[0]) {
                    return 1;
                } else if (a[0] > b[0]) {
                    return -1;
                } else {
                    return 0;
                }
            };
            results.sort(sortDescending);
            if (this.useLevenshtein) {
                var newResults = [],
                    endIndex = Math.min(50, results.length);
                // truncate somewhat arbitrarily to 50
                for (var i = 0; i < endIndex; ++i) {
                    newResults.push([_distance(results[i][1], normalizedValue), results[i][1]]);
                }
                results = newResults;
                results.sort(sortDescending);
            }
            var newResults = [];
            results.forEach(function(scoreWordPair) {
                if (scoreWordPair[0] >= minMatchScore) {
                    newResults.push([scoreWordPair[0], this.exactSet[scoreWordPair[1]]]);
                }
            }.bind(this))
            return newResults;
        };

        fuzzyset.add = function(value) {
            var normalizedValue = this._normalizeStr(value);
            if (normalizedValue in this.exactSet) {
                return false;
            }

            var i = this.gramSizeLower;
            for (i; i < this.gramSizeUpper + 1; ++i) {
                this._add(value, i);
            }
        };

        fuzzyset._add = function(value, gramSize) {
            var normalizedValue = this._normalizeStr(value),
                items = this.items[gramSize] || [],
                index = items.length;

            items.push(0);
            var gramCounts = _gramCounter(normalizedValue, gramSize),
                sumOfSquareGramCounts = 0,
                gram, gramCount;
            for (gram in gramCounts) {
                gramCount = gramCounts[gram];
                sumOfSquareGramCounts += Math.pow(gramCount, 2);
                if (gram in this.matchDict) {
                    this.matchDict[gram].push([index, gramCount]);
                } else {
                    this.matchDict[gram] = [
                        [index, gramCount]
                    ];
                }
            }
            var vectorNormal = Math.sqrt(sumOfSquareGramCounts);
            items[index] = [vectorNormal, normalizedValue];
            this.items[gramSize] = items;
            this.exactSet[normalizedValue] = value;
        };

        fuzzyset._normalizeStr = function(str) {
            if (Object.prototype.toString.call(str) !== '[object String]') throw 'Must use a string as argument to FuzzySet functions';
            return str.toLowerCase();
        };

        // return length of items in set
        fuzzyset.length = function() {
            var count = 0,
                prop;
            for (prop in this.exactSet) {
                if (this.exactSet.hasOwnProperty(prop)) {
                    count += 1;
                }
            }
            return count;
        };

        // return is set is empty
        fuzzyset.isEmpty = function() {
            for (var prop in this.exactSet) {
                if (this.exactSet.hasOwnProperty(prop)) {
                    return false;
                }
            }
            return true;
        };

        // return list of values loaded into set
        fuzzyset.values = function() {
            var values = [],
                prop;
            for (prop in this.exactSet) {
                if (this.exactSet.hasOwnProperty(prop)) {
                    values.push(this.exactSet[prop]);
                }
            }
            return values;
        };

        // initialization
        var i = fuzzyset.gramSizeLower;
        for (i; i < fuzzyset.gramSizeUpper + 1; ++i) {
            fuzzyset.items[i] = [];
        }
        // add all the items to the set
        for (i = 0; i < arr.length; ++i) {
            fuzzyset.add(arr[i]);
        }

        return fuzzyset;
    };

    var root = this;
    // Export the fuzzyset object for **CommonJS**, with backwards-compatibility
    // for the old `require()` API. If we're not in CommonJS, add `_` to the
    // global object.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FuzzySet;
        root.FuzzySet = FuzzySet;
    } else {
        root.FuzzySet = FuzzySet;
    }

})();

var isClose = true;
const stopwords = ["of", "the", "a", "an", "any", "is", "can", "who", "what", "why", "whom", "does", "in"];
var editor = "sorts\n" +
    " #faculty_names = {tianxi, abdul_serwadda, liu_ying, tommy_dang, susan_mengel, tara_salman, shin_eonsuk, zhang_yu, sunho_lim, jingjing_yao, chen_lin, shengshengli, rees_eric, siami_namin_akbar}.\n" +
    "   #cname = {graduateseminar, introtoinforcompsecurity, networksecurity, advoperatingsysdesign, communicationnetworks, informationretrieval, intelligentsystems, softwaremodelingarchitecture, computersystorgarch, communicationsnetworks, parallelprocessing, analysisofalgorithms, theoryofautomata, neuralnetworks, bioinformatics, digitalforensics, datasecurityandprivacy, patternrecognition, wirelessnetandmobilecomp, specialproblemsincomputerscienceaerialcomputing, advdatabasemanagementsystems, cryptography}.\n" +
    "    #terms = {summer, fall}.\n" +
    "    #roles = {professor, graduate_assistant}.\n" +

    "predicates\n" +
    "   designation(#faculty_names, #roles).\n" +
    "   teaches(#faculty_names, #cname).\n" +
    "  offered(#cname, #terms).\n" +
    "rules\n" +
    "designation(tianxi, professor).\n" +
    "designation(abdul_serwadda, professor).\n" +
    "designation(liu_ying, professor).\n" +
    "designation(tommy_dang, professor).\n" +
    "designation(susan_mengel, professor).\n" +
    "designation(tara_salman, professor).\n" +
    "designation(shin_eonsuk, professor).\n" +
    "designation(zhang_yu, professor).\n" +
    "designation(sunho_lim, professor).\n" +
    "designation(jingjing_yao, professor).\n" +
    "designation(chen_lin, professor).\n" +
    "designation(shengshengli, professor).\n" +
    "designation(rees_eric, professor).\n" +
    "designation(siami_namin_akbar, professor).\n" +


    "offered(graduateseminar, fall).\n" +
    "offered(introtoinforcompsecurity, fall).\n" +
    "offered(networksecurity, fall).\n" +
    "offered(advoperatingsysdesign, fall).\n" +
    "offered(informationretrieval, fall).\n" +
    "offered(intelligentsystems, fall).\n" +
    "offered(softwaremodelingarchitecture, fall).\n" +
    "offered(parallelprocessing, fall).\n" +
    "offered(analysisofalgorithms, fall).\n" +
    "offered(theoryofautomata, fall).\n" +
    "offered(neuralnetworks, fall).\n" +
    "offered(bioinformatics, fall).\n" +
    "offered(digitalforensics, fall).\n" +
    "offered(datasecurityandprivacy, fall).\n" +


    "offered(patternrecognition, summer).\n" +
    "offered(wirelessnetandmobilecomp, summer ).\n" +
    "offered(specialproblemsincomputerscienceaerialcomputing, summer).\n" +
    "offered(advdatabasemanagementsystems, summer).\n" +
    "offered(bioinformatics, summer).\n" +
    "offered(cryptography, summer).\n" +

    "teaches(abdul_serwadda, patternrecognition).\n" +
    "teaches(sunho_lim, wirelessnetandmobilecomp). \n" +
    "teaches(sunho_lim, specialproblemsincomputerscienceaerialcomputing).\n" +
    "teaches(rees_eric, bioinformatics).\n" +
    "teaches(abdul_serwadda, cryptography).\n" +

    "teaches(tianxi, graduateseminar).\n" +
    "teaches(abdul_serwadda, introtoinforcompsecurity). \n" +
    "teaches(liu_ying, networksecurity).\n" +
    "teaches(tommy_dang, advoperatingsysdesign).\n " +
    "teaches(susan_mengel, informationretrieval).\n" +
    "teaches(tara_salman, intelligentsystems).\n" +
    "teaches(shin_eonsuk, softwaremodelingarchitecture). \n" +
    "teaches(zhang_yu, parallelprocessing).\n" +
    "teaches(jingjing_yao, analysisofalgorithms).\n" +
    "teaches(chen_lin, theoryofautomata).\n" +
    "teaches(shengshengli, neuralnetworks).\n" +
    "teaches(rees_eric, bioinformatics).\n" +
    "teaches(siami_namin_akbar, digitalforensics).\n" +
    "teaches(tianxi, datasecurityandprivacy).\n";


// sorts
var contstring = editor.split("sorts\n")[1].split("predicates\n");
var sortstring = contstring[0].split('.');
sortstring.splice(-1, 1);
var sorts = {};
sortstring = sortstring.map(d => d.replace(/\n/g, '').trim()).forEach(d => {
    var par = d.split("=");
    sorts[par[0].replace(/#/, '').trim()] = par[1].replace(/{|}/g, '').split(',').map(w => w.trim())
});
// predicates
var predicates = {};
contstring = contstring[1].split("rules\n");
sortstring = contstring[0].split('.');
sortstring.splice(-1, 1);
sortstring.forEach(d => {
    var part = d.replace(/\n/g, '').trim().split('(');
    var func = part[0];
    predicates[func] = {};
    var par = part[1].split(',').map(e => e.replace(/#|\)/g, '').trim());
    var par1 = sorts[par[0]].slice();
    par1.push("X");
    par.splice(0, 1);
    par1.forEach(e => {
        var strinh = (e == 'X' ? '' : (e + ' ')) + func;
        predicates[func][strinh] = func + "(" + e + ")";
        par.forEach(par2 => {
            var temp = sorts[par2].slice();
            temp.push("X");
            temp.forEach(t => {
                var strinh = (e == 'X' ? '' : (e + ' ')) + func + (t == 'X' ? '' : (' ' + t));
                // if (strinh != fubnc)
                predicates[func][strinh] = func + "(" + e + "," + t + ")";
            })
        });
    });
});


var all_predicates = [];
for (var key1 in predicates) {
    if (predicates.hasOwnProperty(key1)) {
        for (var key2 in predicates[key1]) {
            if (predicates[key1].hasOwnProperty(key2))
                all_predicates.push(key2);
        }
    }

}
all_predicates.push('speak spanish'); // extra terms
a = FuzzySet(all_predicates);

console.log(all_predicates)


// Speech recognition API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = 'en-US';

// Get DOM elements
const answerDiv = document.querySelector('#answer');
const voiceBtn = document.getElementById('voice-input-btn');
const textInput = document.getElementById('chatbox');
const answerBox = document.getElementById('answer-box');
const answerlabel = document.getElementById('answer_label');
const mute_unmute_btn = document.getElementById('mute-input-btn');
const cancel_speech_btn = document.getElementById('cancel-speech-btn');




// Handle speech recognition
recognition.onresult = event => {
    const resultIndex = event.resultIndex;
    const transcript = event.results[resultIndex][0].transcript;
    textInput.value = transcript;

    var trim_script = transcript.split(" ");
    trim_script = trim_script.filter(f => !stopwords.includes(f));
    var queryQues = a.get(trim_script.join(" "), null, 0.5);
    console.log(queryQues);
    getAnswer(queryQues);
};


var mute = false;

// Handle click on voice input button     
function startSpeechRecognition() {
    recognition.start();
}
voiceBtn.addEventListener('click', startSpeechRecognition);


function getAnswer(question) {

    if (question != null) {
        var mainkey = question[0][1].replace('speak ', '');
        var answerarr = mainkey.split(' ');
        var key1 = '';
        answerarr.forEach(d => {
            key1 = (predicates[d] != undefined) ? d : key1;
        });
        //var key1 = answerarr.length>2? answerarr[1]:answerarr[0];
        var key2 = mainkey;
        console.log(key1 + '-' + key2);
        console.log(predicates[key1][key2]);

        var data = {
            'action': "getQuery",
            'query': predicates[key1][key2],
            'editor': editor
        };

        console.log(data)

        //Ajax Request being sent to ASP Resolver End point

        $.ajax({
            url: "https://cors-anywhere.herokuapp.com/http://wave.ttu.edu/ajax.php",
            type: "POST",
            headers: {
                "X-Requested-With": "XMLHttpRequest"
            },
            data: {
                action: "getQuery",
                query: predicates[key1][key2],
                editor: editor
            },
            success: function(response) {
                console.log(response);
                String(response);

                let answer = response || 'Sorry, I could not find an answer.';

                answerlabel.innerHTML = answer;
                if (mute != true) {
                    Speech(answer);
                }


            },
            error: function(xhr, status, error) {
                console.log("error: " + error);
                messages.push("<b>" + botName + "" + "error");
            }
        });

    }
}




var messages = [], //array that hold the record of each string in chat
    lastUserMessage = "", //keeps track of the most recent input string from the user
    talking = true; //when false the speach function doesn't work

function chatbotResponse() {
    talking = true;
    const question = lastUserMessage;
    var trim_script = question.split(" ");
    trim_script = trim_script.filter(f => !stopwords.includes(f));
    var queryQues = a.get(trim_script.join(" "), null, 0.5);
    getAnswer(queryQues);
}



// Handle the last message entered by user
function newEntry() {
    if (document.getElementById("chatbox").value != "") {
        lastUserMessage = document.getElementById("chatbox").value;
        document.getElementById("chatbox").value = "";
        messages = [];
        messages.push(lastUserMessage);

        if (mute != true) {
            window.speechSynthesis.cancel();
            Speech(lastUserMessage);
        }


        chatbotResponse();
        for (var i = 1; i < 8; i++) {
            if (messages[messages.length - i])
                document.getElementById("chatlog" + i).innerHTML = messages[messages.length - i];
        }
    }
}


mute_unmute_btn.addEventListener('click', handleMute_Unmute);


// Mute the text to speech and cancel speech queue
function handleMute_Unmute() {

    mute = !mute;
    mute_unmute_btn.innerHTML = mute ? 'Unmute' : 'Mute';
    console.log(mute);
    var status = mute ? 'Enabled' : 'Disabled';
    alertify.message('Mute '+ status);
    window.speechSynthesis.cancel();
}


cancel_speech_btn.addEventListener('click', cancelSpeech);


// Mute the text to speech and cancel speech queue
function cancelSpeech() {
    window.speechSynthesis.cancel();
     alertify.message('Speech Cancelled');
}



// Text to speech functionality
function Speech(say) {
    if ('speechSynthesis' in window && talking) {
        var utterance = new SpeechSynthesisUtterance(say);
        speechSynthesis.speak(utterance);
    }
}

//runs the keypress() function when a key is pressed
document.onkeypress = keyPress;
//if the key pressed is 'enter' runs the function newEntry()
function keyPress(e) {
    var x = e || window.event;
    var key = (x.keyCode || x.which);
    if (key == 13 || key == 3) {
        //runs this function when enter is pressed
        newEntry();


    }
    if (key == 38) {
        console.log('hi')
        //document.getElementById("chatbox").value = lastUserMessage;
    }
}

//clears the placeholder text ion the chatbox
//this function is set to run when the users brings focus to the chatbox, by clicking on it
function placeHolder() {
    document.getElementById("chatbox").placeholder = "";
}


alertify
  .alert('Hola!','Use "Mute" button to  disable Text Speech and "Cancel Speech" to cancel the speech in progress', function(){
   
  });