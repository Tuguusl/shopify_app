(function () {

    return {
        defaultState: 'setup',

        events: {
            'app.created': 'init'
        },

        init: function () {
            var account = this.currentAccount();
            this.switchTo('setup', { subdomain: account.subdomain()})
        }
    };
}());
