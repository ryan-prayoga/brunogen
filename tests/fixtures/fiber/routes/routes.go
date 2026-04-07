package main

import "github.com/gofiber/fiber/v2"

func SetupRoutes(app *fiber.App) {
	api := app.Group(
		"/api",
	)
	widgets := api.Group(
		"/widgets",
		Protected(),
	)
	widgets.Get(
		"/",
		listWidgets,
	)
	widgets.Post(
		"/",
		createWidget,
	)
	widgets.Get(
		"/:id",
		getWidget,
	)
	widgets.Delete(
		"/:id",
		deleteWidget,
	)
}
