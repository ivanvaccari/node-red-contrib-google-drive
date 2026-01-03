import { NodeAPI, Node } from 'node-red'

class GoogleDriveNode {

    private node: Node;
    constructor(config: any, RED: NodeAPI) {
        // Initialize the node here
        this.node = this as any as Node;
        RED.nodes.createNode(this.node, config);

        this.node.on('input', this.onInput);
    }

    private onInput(msg: any) {
        // Handle input message
        msg.payload = msg.payload.toLowerCase();
        this.node.send(msg);
    }
}
const _export = function (RED: NodeAPI) {


    function GoogleDriveNodeFactory(config: any) {
        /*var node: Node = this as any as Node
        RED.nodes.createNode(this, config)
        var node = this
        node.on('input', function (msg: any) {
            msg.payload = msg.payload.toLowerCase()
            node.send(msg)
        })*/

        return new GoogleDriveNode(config, RED);
    }
    RED.nodes.registerType('google-drive', GoogleDriveNodeFactory)
}

export = _export
