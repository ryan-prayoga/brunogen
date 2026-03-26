package main

type UserResponse struct {
	ID        uint   `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Age       int    `json:"age"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

type ListUsersResponse struct {
	Data []UserResponse `json:"data"`
	Page int            `json:"page"`
}
