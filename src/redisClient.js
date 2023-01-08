const redis = require('redis')
const jwt = require("jsonwebtoken")
const { createHash } = require('crypto')

class RedisClient{
    HASH_ALGORITHM = "sha256"
    HASH_FORMAT = 'hex'
    DENY_LIST_JWT_PREFIX = 'denyJWT'
    DENY_LIST_USER_ID_PREFIX = 'denyUserID'
    ORG_INFLUX_PREFIX = 'orgInflux'
    ORG_APP_MGNT_PREFIX = 'orgAppMgnt'
    DO_HASH_TOKEN = true
    DO_HASH_USER_ID = false
    URL = process.env.REDIS_URL

    constructor(){
        this.client = redis.createClient({url: this.URL})
    }

    async connect(){
        await this.client.connect()
        console.log(`REDIS CLIENT CONNECTED WITH URL ${this.URL}`)
    }

    async pushDenyListJWT(token){
        const expireAt = jwt.decode(token).exp
        return await this._push(token, this.DENY_LIST_JWT_PREFIX, this.DO_HASH_TOKEN, expireAt)
    }

    async isInDenyListJWT(token){
        return await this._checkExists(token, this.DENY_LIST_JWT_PREFIX, this.DO_HASH_TOKEN)
    }

    async pushDenyUserId(userId){
        return await this._push(userId, this.DENY_LIST_USER_ID_PREFIX, this.DO_HASH_TOKEN, 0)
    }

    async isInDenyListUserId(userId){
        return await this._checkExists(userId, this.DENY_LIST_USER_ID_PREFIX, this.DO_HASH_USER_ID)
    }

    async getOrgAppMgnt(orgId){
        const keyInflux = this._adaptKey(orgId, this.ORG_APP_MGNT_PREFIX, false)
        return await this.client.get(keyInflux)
    }

    async getOrgInflux(orgId){
        const keyInflux = this._adaptKey(orgId, this.ORG_INFLUX_PREFIX, false)
        return await this.client.get(keyInflux)
    }

    async setOrgAppMgnt(orgId, orgAppMgnt){
        const keyInflux = this._adaptKey(orgId, this.ORG_APP_MGNT_PREFIX, false)
        return await this.client.set(keyInflux, orgAppMgnt)
    }

    async setOrgInflux(orgId, orgInflux){
        const keyInflux = this._adaptKey(orgId, this.ORG_INFLUX_PREFIX, false)
        return await this.client.set(keyInflux, orgInflux)
    }

    async _push(key, prefix, doHash, expireAt){
        let keyToSave = this._adaptKey(key, prefix, doHash)
        await this.client.set(keyToSave, "")
        if (expireAt) await this.client.expireAt(keyToSave, expireAt)
    }


    async _checkExists(key, prefix, doHash){
        let keyToCheck = this._adaptKey(key, prefix, doHash)
        const exists = await this.client.exists(keyToCheck)
        return exists
    }

    _adaptKey(key, prefix, doHash){
        let adaptedKey = doHash?this._getHash(key):key
        adaptedKey = this._updateWithPrefix(adaptedKey, prefix)
        return adaptedKey
    }

    _updateWithPrefix(value, prefix){
        return `${prefix}:${value}`
    }

    _getHash(value){
        return createHash(this.HASH_ALGORITHM).update(value).digest(this.HASH_FORMAT)
    }

}

module.exports = {
    redisClient: new RedisClient()
}



    