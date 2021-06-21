const core = require('@actions/core');
const { request } = require("@octokit/request");
const fs = require('fs')

var excludedReposPath = '';
var includedReposPath = '';

async function run() {
    const token = core.getInput("token");
    const orgName = core.getInput("org")
    const rulesPath = core.getInput("rulesPath");
    excludedReposPath = core.getInput("excludedReposPath");
    includedReposPath = core.getInput("includedReposPath");
    const action = core.getInput("action");
    const limit = 100;
    var rulesObj;
    var branches;
    try {
        if(!fs.existsSync(rulesPath)){
            throw "Rules JSON is missing."
        }
        const rules = fs.readFileSync(rulesPath, {encoding:'utf8', flag:'r'});
        rulesObj = JSON.parse(rules);
        keys = Object.keys(rulesObj);
        var repos = await getFinalRepos(token, orgName);  
        for (let i = 0; i < repos.length; i++) {
            branches = await getBranches(token, repos[i], keys);  
            for (let j = 0; j < branches.length; j++) {
                if(branches[j].protected){
                    console.log("Deleting Branch Protection for " + branches[j].name + " of " + repos[i]);
                    core.debug("Deleting Branch Protection for " + branches[j].name + " of " + repos[i]);
                    await deleteProtection(token, repos[i], branches[j].name);
                }
                if(action == "set"){
                    console.log("Setting Branch Protection for " + branches[j].name + " of " + repos[i]);
                    core.debug("Setting Branch Protection for " + branches[j].name + " of " + repos[i]);
                    await setProtection(token, repos[i], branches[j].name, rulesObj[branches[j].name] )
                }
            }     
        }
  }
  catch(e){
    console.error(e);
    core.setFailed(e.stack);
  }
}

async function setProtection(token, repoName, branchName, ruleData){
    const url = "/repos/" + repoName + "/branches/" + branchName + "/protection"
    if(ruleData == ""){
        ruleData = {
            'required_status_checks': None,
            'restrictions': {
                'users': [],
                'teams': [],
            },
        }
    }
    try {
        const result = await request("PUT " + url, {
            headers: {
            authorization: "token " + token,
            },
            data: ruleData
        });
        console.log(result.data);
        core.debug(result.data);
    }
    catch(e){
        console.error(e);
        core.setFailed("Exception Occurred in Set Protection: " + e.stack);
    }
}

async function deleteProtection(token, repoName, branchName){
    const url = "/repos/" + repoName + "/branches/" + branchName + "/protection"
    try{
        const result = await request("DELETE " + url, {
            headers: {
            authorization: "token " + token,
            }
        });
        if(result.status != 204){
            throw "Exception occured during Delete Protection";
        }
    }
    catch(e){
        console.error(e);
        core.setFailed("Exception Occurred in Delete Protection: " + e.stack);
    }
}

async function getBranches(token, repoName, branchNames){
    branchInfoArr = [];
    const url = "/repos/" + repoName + "/branches"
    try {
        const result = await request("GET " + url, {
            headers: {
            authorization: "token " + token,
            }
        });
        branchData = result.data;
        for (let j = 0; j < branchData.length; j++) {
            const element = branchData[j];
            if(branchNames.includes(element.name)){
                branchInfoArr.push(element);
            }
        }
    }
    catch(e) {
        console.error(e);
        core.setFailed("Exception Occurred in Get Branches: " + e.stack);
    }
    return branchInfoArr;
}

async function getRepoCount(token, orgName){
    repoCnt = 0;
    try {
        const result = await request("GET /orgs/{org}/repos", {
            headers: {
            authorization: "token " + token,
            },
            org: orgName,
            per_page:1,
            type: "all"
        });
        const respUrl = new URL(result.headers.link.split(',')[1].split(';')[0].trim().replace('<','').replace('>',''));
        repoCnt = parseInt(respUrl.searchParams.get('page'));
    }
    catch(e){
        console.error(e);
        core.setFailed("Exception Occurred in Get Repo Count: " + e.stack);
    }
    return repoCnt;
}

function getPageCount(itemCount, limit){
    pageCount = (itemCount < limit) ? 1 : (((itemCount % limit) > 0) ? (Math.floor(itemCount/limit) + 1) : (itemCount/limit));
    return pageCount;
}

async function getPagedRepos(token, orgName, pageNum, limit){
    var repos = [];
    try {
        const result = await request("GET /orgs/{org}/repos", {
            headers: {
            authorization: "token " + token,
            },
            org: orgName,
            per_page:limit,
            type: "all",
            page: pageNum
        });
        result.data.forEach(repo => {
            repos.push(repo.full_name);
        });
    }
    catch(e){
        console.error(e);
        core.setFailed("Exception Occurred in Get Paged Repos: " + e.stack);
    }
    return repos;
}

async function getFinalRepos(token, orgName){
    repos = [];
    includedRepos = [];
    limit = 100;
    try {
        includedRepos = getReposFromFile(includedReposPath);
        if(includedRepos.length > 0){
            for (let k = 0; k < includedRepos.length; k++) {
                includedRepos[k] = orgName + "/" + includedRepos[k];            
            }
            return includedRepos;
        }
        repoCount = await getRepoCount(token, orgName); 
        pageCnt = getPageCount(repoCount, limit);
        excludedRepos = getReposFromFile(excludedReposPath);
        for (let i = 0; i < pageCnt; i++) {
            i = i + 1;
            pagedRepos = await getPagedRepos(token, orgName, i, limit);
            for (let j = 0; j < pagedRepos.length; j++) {
                repoShortName = pagedRepos[j].replace(orgName + "/","");
                if(!excludedRepos.includes(repoShortName)) {
                    repos.push(pagedRepos[j]);     
                }      
            } 
        }
    }
    catch(e){
        console.error(e);
        core.setFailed("Exception Occurred in Get Paged Repos: " + e.stack);
    }
    return repos;
}

function getReposFromFile(repoFilePath){
    repoArr = [];
    try {
        if(fs.existsSync(repoFilePath)){
            const reposFrmFile = fs.readFileSync(repoFilePath, {encoding:'utf8', flag:'r'});
            if(reposFrmFile != ''){
                reposFrmFile.trim().split(/\r?\n/).forEach(element => {
                    if(element != ''){
                        repoArr.push(element);
                    }
                });        
            }
        } 
    }   
    catch(e){
        console.error(e);
        core.setFailed("Exception Occurred in Get Repos From File: " + e.stack);
    }
    return repoArr;
}

run();
