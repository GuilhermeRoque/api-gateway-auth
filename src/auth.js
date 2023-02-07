const { getToken } = require('web-service-utils/controller');
const util = require('util')
const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('web-service-utils/serviceErrors');
const verifyAsync = util.promisify(jwt.verify)
const {redisClient} = require("./redisClient");
const { HttpStatusCodes } = require('web-service-utils/enums');

class MemberError extends ForbiddenError{
    constructor(user){
        super(user, "Must be a member of the organization")
    }
}

class MemberStatusError extends ForbiddenError{
    constructor(user, status){
        super(user, `Must have status ${status} to do this operation`)
    }
}

const checkRoleNeeded = (organization, caller, roleNeeded) => {
    const member = getMember(organization, caller)
    if (member.status !== MemberStatusEnum.ACTIVE) throw new MemberStatusError(member, MemberStatusEnum.ACTIVE)
    if (member.role > roleNeeded) throw new RoleError(member, roleNeeded)
}

const getMember = (organization, caller) => {
    const userId = caller._id
    const memberIndex = findMemberIndex(organization, userId)
    if (memberIndex === -1) throw new MemberError(caller)
    return organization.members[memberIndex]

}

const findMemberIndex = (organization, userId) => {
    const index = organization.members.findIndex(member => {
        return member.userId.toString() === userId;
    });
    return index
}

async function removeAccessToken(accessToken){
    if(accessToken){
        try {
            await verifyAsync(accessToken, process.env.ACCESS_TOKEN_SECRET, {algorithm: ["RS256"]})        
            await redisClient.pushDenyListJWT(accessToken)
        } catch (error) {console.log("Error! accessToken will not be added to deny list", accessToken)}
    }
}

async function removeRefreshToken(refreshToken){
    if(refreshToken){
        try {
            await verifyAsync(refreshToken, process.env.REFRESH_TOKEN_SECRET, {algorithm: ["RS256"]})        
            await redisClient.pushDenyListJWT(refreshToken)
        } catch (error) {console.log("Error! refreshToken will not be added to deny list", refreshToken)}
    }
}

async function signout(accessToken, refreshToken){
    removeAccessToken(accessToken)
    removeRefreshToken(refreshToken)
}

// check if token is in deny list -> check if token is valid -> check if user is in deny list
async function verify(accessToken){
    if (!accessToken) throw new UnauthorizedError("Access token missing")
    const isInDenyListJWT = await redisClient.isInDenyListJWT(accessToken)
    if (isInDenyListJWT) throw new UnauthorizedError("Access token is in deny list", {accessToken: accessToken})

    let user = undefined
    try {
        const payload = await verifyAsync(accessToken, process.env.ACCESS_TOKEN_SECRET,  {algorithm: ["RS256"]})
        user = payload.user
    } catch (error) {
        throw new UnauthorizedError("Access token is invalid", {accessToken: accessToken})        
    }
    const userId = user._id
    const isInDenyUserList = await redisClient.isInDenyListUserId(userId)
    if (isInDenyUserList) throw new UnauthorizedError("User is in deny list", {accessToken: accessToken, user: user})
    return {user: user, accessToken: accessToken}

}

const verifyAccessToken = (async (req, res, next) => {
    try {
        const accessToken = getToken(req)
        const userToken = await verify(accessToken)
        req.headers.user = JSON.stringify(userToken.user)
        next()                
    } catch (error) {
        next(error)
    }
})

const logout = (async (req, res, next) => {
    const cookies = req.cookies;
    const refreshToken = cookies?.jwt;
    const accessToken = getToken(req)
    try {
        await signout(accessToken, refreshToken)
        res.sendStatus(HttpStatusCodes.OK)
    } catch (error) {
       next(error) 
    }
})

const refresh = (async (req, res, next) => {
    const cookies = req.cookies;
    const refreshToken = cookies?.jwt;
    try {
        if (!refreshToken) throw new UnauthorizedError("Refresh token missing") 
        const denyToken = await redisClient.isInDenyListJWT(refreshToken)
        if (denyToken) throw new UnauthorizedError("Token is in deny list", {token: refreshToken})    
        let userId = undefined
        try {
            const payload = await verifyAsync(refreshToken, process.env.REFRESH_TOKEN_SECRET, {algorithm: ["RS256"]})            
            userId = payload.userId
            req.headers.user_refresh = userId    
            next()            
        } catch (error) {
            throw new UnauthorizedError("Invalid token", {token: refreshToken})
        }

    } catch (error) {
        next(error)
    }
})

module.exports = {
    verifyAccessToken: verifyAccessToken,
    logout:logout,
    refresh:refresh,
    checkRoleNeeded:checkRoleNeeded
}