const ghSuccessIcons = ["icons/success/baracktocat.png", "icons/success/mardigrastocat.png", "icons/success/welcometocat.png"];
const ghErrorIcons = ["icons/error/luchadortocat.png", "icons/error/minion.png", "icons/error/octofez.png"];

function randomItemFormList(items) {
	return items[~~(items.length * Math.random())];
}

function getIconFor(message) {
	if (message.startsWith("✅")) {
		return randomItemFormList(ghSuccessIcons)
	} else if (message.startsWith("❌")) {
		return randomItemFormList(ghErrorIcons);
	}
	return 'icons/icon128.png';
}

chrome.extension.onMessage.addListener(
	(request, sender, sendResponse) => {
		const notificationId = sender.tab.id.toString();
		chrome.notifications.clear(notificationId, (wasCleared) => {});
		const iconUrlForNotification = getIconFor(request.content);
		chrome.notifications.create(
			notificationId, {
				type: 'basic',
				iconUrl: iconUrlForNotification,
				title: sender.tab.title.split("·")[0].trim(),
				message: request.content
			},
			(notificationId) => {
				const handler = (id) => {
					if (id == notificationId) {
						chrome.tabs.update(parseInt(id), {
							highlighted: true
						}, (tab) => {});
						// todo: foreground window
						chrome.notifications.clear(id);
						chrome.notifications.onClicked.removeListener(handler);
					}
				};
				chrome.notifications.onClicked.addListener(handler);
				if (typeof sendResponse == "function") sendResponse();
			}
		);
		sendResponse();
	}
);
